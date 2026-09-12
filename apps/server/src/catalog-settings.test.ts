import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { makeBenchRunMeta } from "./bench-runner.js";
import { closeProdBenchDatabase, finishRun, insertRun, openBenchDatabase, upsertScenarioAggregate } from "./db/database.js";
import type { DetectResult } from "@llm-bench/shared";

it("settings list expands while default scoreboard selects the newest group exactly once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-settings-"));
  const path = join(dir, "bench.sqlite");
  const d: DetectResult = { provider: "openai_compatible", baseUrl: "http://localhost:1234", models: [{ id: "m" }], steps: [], capabilities: { openaiChat: true, anthropicMessages: false } };
  vi.stubEnv("BENCH_DB_PATH", path);
  vi.stubEnv("BENCH_API_KEYS", "");
  closeProdBenchDatabase();
  try {
    const db = openBenchDatabase(path);
    for (const [i, temperature] of [0.2, 0.8].entries()) {
      const meta = makeBenchRunMeta({ baseUrl: d.baseUrl, provider: d.provider, modelId: "m", temperature }, d, `r${i}`);
      insertRun(db, { run_id: meta.run_id, created_at: meta.created_at, base_url: meta.base_url, provider: meta.provider, model_id: meta.model_id, meta, status: "running" });
      upsertScenarioAggregate(db, { run_id: meta.run_id, scenario_id: "chat_ping", api_route: "chat_completions", aggregate_json: JSON.stringify({ runs: [{ ttft_ms: 1, total_ms: 10, output_text: "ok", stream_completed: true, quality: { pass: true, score: 1 } }] }), prompt_preview: "ping", prompt_system_preview: "system" });
      finishRun(db, meta.run_id, "ok");
    }
    db.close();
    const app = createApp();
    for (const prefix of ["/api", "/api/v1"]) {
      const list = await (await app.request(`${prefix}/stats/model-latest`)).json();
      expect(list.items).toHaveLength(2);
      expect(list.items.every((it: { config_complete: boolean }) => it.config_complete)).toBe(true);
      const board = await (await app.request(`${prefix}/scoreboard?baseUrl=${encodeURIComponent(d.baseUrl)}`)).json();
      expect(board.rows).toHaveLength(1);
      expect(board.leaks[0].n).toBe(1);
      const latest = await (await app.request(`${prefix}/runs/latest-by-model?baseUrl=${encodeURIComponent(d.baseUrl)}&modelIds=m`)).json();
      expect(latest.items[0].run.meta.run_id).toBe("r1");
      expect(latest.items[0].run.scenarios[0].source_run_id).toBe("r1");
      const old = await (await app.request(`${prefix}/runs/r0?profile=merged`)).json();
      expect(old.meta.run_id).toBe("r0");
    }
  } finally {
    closeProdBenchDatabase();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});
