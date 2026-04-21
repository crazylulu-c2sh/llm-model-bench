import type { DetectResult } from "@llm-bench/shared";
import { describe, expect, it } from "vitest";
import { makeBenchRunMeta, type BenchRequest } from "../bench-runner.js";
import { finishRun, insertRun, listLatestFinishedRunSummaries, openBenchDatabase, upsertScenarioAggregate } from "./database.js";

const detect: DetectResult = {
  provider: "openai_compatible",
  baseUrl: "http://localhost:8080/",
  models: [{ id: "mx" }],
  steps: [],
  capabilities: { openaiChat: true, anthropicMessages: false },
};

function req(modelId: string, baseUrl?: string): BenchRequest {
  return {
    baseUrl: baseUrl ?? detect.baseUrl,
    provider: detect.provider,
    modelId,
    parallel: false,
    skipModelLoad: true,
  };
}

describe("listLatestFinishedRunSummaries", () => {
  it("returns newest finished run per (model_id, base_url)", async () => {
    const db = openBenchDatabase(":memory:");
    const meta1 = makeBenchRunMeta(req("mx"), detect, "run_old");
    insertRun(db, {
      run_id: meta1.run_id,
      created_at: meta1.created_at,
      base_url: meta1.base_url.replace(/\/+$/, ""),
      provider: meta1.provider,
      model_id: meta1.model_id,
      meta: meta1,
      status: "running",
    });
    finishRun(db, meta1.run_id, "ok");

    await new Promise((r) => setTimeout(r, 30));

    const meta2 = makeBenchRunMeta(req("mx"), detect, "run_new");
    insertRun(db, {
      run_id: meta2.run_id,
      created_at: meta2.created_at,
      base_url: meta2.base_url.replace(/\/+$/, ""),
      provider: meta2.provider,
      model_id: meta2.model_id,
      meta: meta2,
      status: "running",
    });
    finishRun(db, meta2.run_id, "ok");

    const rows = listLatestFinishedRunSummaries(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.run_id).toBe(meta2.run_id);
    expect(rows[0]?.model_id).toBe("mx");
    expect(rows[0]?.base_url).toBe("http://localhost:8080");
    expect(rows[0]?.scenario_count).toBe(0);
  });

  it("keeps separate rows for same model_id on different base_url", () => {
    const db = openBenchDatabase(":memory:");
    const d2: DetectResult = { ...detect, baseUrl: "http://other:9000/" };
    const m1 = makeBenchRunMeta(req("mx"), detect, "run_a");
    insertRun(db, {
      run_id: m1.run_id,
      created_at: m1.created_at,
      base_url: m1.base_url.replace(/\/+$/, ""),
      provider: m1.provider,
      model_id: m1.model_id,
      meta: m1,
      status: "running",
    });
    finishRun(db, m1.run_id, "ok");

    const m2 = makeBenchRunMeta(req("mx"), d2, "run_b");
    insertRun(db, {
      run_id: m2.run_id,
      created_at: m2.created_at,
      base_url: m2.base_url.replace(/\/+$/, ""),
      provider: m2.provider,
      model_id: m2.model_id,
      meta: m2,
      status: "running",
    });
    finishRun(db, m2.run_id, "ok");

    const rows = listLatestFinishedRunSummaries(db);
    expect(rows).toHaveLength(2);
    const ids = new Set(rows.map((r) => r.run_id));
    expect(ids.has("run_a")).toBe(true);
    expect(ids.has("run_b")).toBe(true);
    for (const r of rows) {
      expect(r.scenario_count).toBe(0);
    }
  });

  it("scenario_count counts only scenarios with non-empty runs array", () => {
    const db = openBenchDatabase(":memory:");
    const meta = makeBenchRunMeta(req("mx"), detect, "run_with_data");
    insertRun(db, {
      run_id: meta.run_id,
      created_at: meta.created_at,
      base_url: meta.base_url.replace(/\/+$/, ""),
      provider: meta.provider,
      model_id: meta.model_id,
      meta,
      status: "running",
    });
    upsertScenarioAggregate(db, {
      run_id: meta.run_id,
      scenario_id: "chat_ping",
      api_route: "chat_completions",
      aggregate_json: JSON.stringify({
        scenario_id: "chat_ping",
        api_route: "chat_completions",
        runs: [{ ttft_ms: 1, tpot_ms: 2, total_ms: 10, output_text: "x", stream_completed: true }],
      }),
      prompt_preview: "p",
    });
    upsertScenarioAggregate(db, {
      run_id: meta.run_id,
      scenario_id: "empty_runs",
      api_route: "chat_completions",
      aggregate_json: JSON.stringify({
        scenario_id: "empty_runs",
        api_route: "chat_completions",
        runs: [],
      }),
      prompt_preview: null,
    });
    finishRun(db, meta.run_id, "ok");
    const rows = listLatestFinishedRunSummaries(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scenario_count).toBe(1);
  });

  it("excludes running-only rows without finished_at", () => {
    const db = openBenchDatabase(":memory:");
    const m = makeBenchRunMeta(req("mx"), detect, "run_unfinished");
    insertRun(db, {
      run_id: m.run_id,
      created_at: m.created_at,
      base_url: m.base_url.replace(/\/+$/, ""),
      provider: m.provider,
      model_id: m.model_id,
      meta: m,
      status: "running",
    });
    expect(listLatestFinishedRunSummaries(db)).toHaveLength(0);
  });
});
