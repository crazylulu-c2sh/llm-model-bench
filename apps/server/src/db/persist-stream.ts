import type { BenchRunMeta, StreamEvent } from "@llm-bench/shared";
import { getScenarioUserPromptPreview } from "@llm-bench/shared";
import type Database from "better-sqlite3";
import { appendTextLog, finishRun, insertRun, markRunErrorPartial, upsertScenarioAggregate } from "./database.js";

function promptPreviewForScenario(scenarioId: string, meta: BenchRunMeta | null): string {
  if (scenarioId === "translate_nist_fips197_pdf_tools") {
    const base = meta?.public_assets_origin;
    return getScenarioUserPromptPreview(scenarioId, { publicAssetBaseUrl: base });
  }
  return getScenarioUserPromptPreview(scenarioId);
}

export class BenchRunPersistence {
  private logSeq = 0;
  private runId: string | null = null;
  private hadError = false;
  private lastMeta: BenchRunMeta | null = null;
  /** `scenario_id|api_route` → 마지막 `scenario_start.user_prompt` (동적 프롬프트 정합) */
  private lastUserPromptByScenarioKey = new Map<string, string>();

  constructor(private readonly db: Database.Database | null) {}

  start(meta: BenchRunMeta): void {
    if (!this.db) return;
    this.runId = meta.run_id;
    this.lastMeta = meta;
    this.logSeq = 0;
    this.hadError = false;
    this.lastUserPromptByScenarioKey.clear();
    insertRun(this.db, {
      run_id: meta.run_id,
      created_at: meta.created_at,
      base_url: meta.base_url.replace(/\/+$/, ""),
      provider: meta.provider,
      model_id: meta.model_id,
      meta,
      status: "running",
    });
    this.logLine(`bench stream started model=${meta.model_id}`);
  }

  onEvent(ev: StreamEvent): void {
    if (!this.db || !this.runId) return;
    switch (ev.type) {
      case "scenario_start": {
        const sid = ev.scenario_id;
        const route = ev.api_route;
        const up = ev.user_prompt;
        if (typeof sid === "string" && (route === "chat_completions" || route === "messages") && typeof up === "string") {
          this.lastUserPromptByScenarioKey.set(`${sid}|${route}`, up);
        }
        break;
      }
      case "metrics_update": {
        const agg = ev.aggregate as {
          scenario_id?: string;
          api_route?: string;
          runs?: unknown;
        };
        const sid = agg.scenario_id;
        const route = agg.api_route;
        if (typeof sid === "string" && (route === "chat_completions" || route === "messages")) {
          const key = `${sid}|${route}`;
          const snapshot = this.lastUserPromptByScenarioKey.get(key);
          const promptPreview = snapshot ?? promptPreviewForScenario(sid, this.lastMeta);
          upsertScenarioAggregate(this.db, {
            run_id: this.runId,
            scenario_id: sid,
            api_route: route,
            aggregate_json: JSON.stringify(agg),
            prompt_preview: promptPreview,
          });
        }
        this.logLine(`metrics_update ${sid ?? "?"} ${route ?? "?"}`);
        break;
      }
      case "error": {
        this.hadError = true;
        markRunErrorPartial(this.db, this.runId, ev.code, ev.message);
        this.logLine(`error[${ev.layer}] ${ev.code}: ${ev.message.slice(0, 500)}`);
        break;
      }
      case "scenario_end":
        this.logLine(
          `scenario_end ${ev.scenario_id} ttft=${ev.metrics.ttft_ms ?? "null"} pass=${ev.quality?.pass ?? "n/a"}`,
        );
        break;
      case "run_finished":
        this.logLine(`run_finished ${ev.run_id}`);
        break;
      default:
        break;
    }
  }

  finalize(): void {
    if (!this.db || !this.runId) return;
    finishRun(this.db, this.runId, this.hadError ? "partial" : "ok");
    this.runId = null;
    this.lastMeta = null;
    this.lastUserPromptByScenarioKey.clear();
  }

  private logLine(line: string): void {
    if (!this.db || !this.runId) return;
    appendTextLog(this.db, this.runId, this.logSeq++, line);
  }
}
