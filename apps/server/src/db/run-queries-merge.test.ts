import type { DetectResult } from "@llm-bench/shared";
import { describe, expect, it } from "vitest";
import { makeBenchRunMeta, type BenchRequest } from "../bench-runner.js";
import {
  finishRun,
  insertRun,
  listLatestFinishedRunSummaries,
  openBenchDatabase,
  upsertScenarioAggregate,
} from "./database.js";
import { mergedBenchDetailFromDb, mergedBenchDetailFromRunId } from "./run-queries.js";

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
    skipModelLoad: true,
  };
}

function withRuns(runId: string, scenarioId: string, output: string, apiRoute = "chat_completions") {
  return {
    run_id: runId,
    scenario_id: scenarioId,
    api_route: apiRoute,
    aggregate_json: JSON.stringify({
      scenario_id: scenarioId,
      api_route: apiRoute,
      runs: [{ ttft_ms: 1, total_ms: 10, output_text: output, stream_completed: true }],
    }),
    prompt_preview: "p",
    prompt_system_preview: "sp",
  };
}

function emptyRuns(runId: string, scenarioId: string, apiRoute = "chat_completions") {
  return {
    run_id: runId,
    scenario_id: scenarioId,
    api_route: apiRoute,
    aggregate_json: JSON.stringify({
      scenario_id: scenarioId,
      api_route: apiRoute,
      runs: [],
    }),
    prompt_preview: null,
    prompt_system_preview: null,
  };
}

describe("mergedBenchDetailFromDb", () => {
  it("merges 26→1 re-run: keeps older scenarios and prefers newer overlapping measurement", async () => {
    const db = openBenchDatabase(":memory:");
    const metaOld = makeBenchRunMeta(req("mx"), detect, "run_full");
    insertRun(db, {
      run_id: metaOld.run_id,
      created_at: metaOld.created_at,
      base_url: metaOld.base_url.replace(/\/+$/, ""),
      provider: metaOld.provider,
      model_id: metaOld.model_id,
      meta: metaOld,
      status: "running",
    });
    upsertScenarioAggregate(db, withRuns("run_full", "chat_hello", "old-hello"));
    upsertScenarioAggregate(db, withRuns("run_full", "chat_ping", "old-ping"));
    upsertScenarioAggregate(db, withRuns("run_full", "vision_table_ocr_a", "old-vision"));
    finishRun(db, "run_full", "ok");

    await new Promise((r) => setTimeout(r, 30));

    const metaNew = makeBenchRunMeta(req("mx"), detect, "run_quick");
    insertRun(db, {
      run_id: metaNew.run_id,
      created_at: metaNew.created_at,
      base_url: metaNew.base_url.replace(/\/+$/, ""),
      provider: metaNew.provider,
      model_id: metaNew.model_id,
      meta: metaNew,
      status: "running",
    });
    upsertScenarioAggregate(db, withRuns("run_quick", "chat_ping", "new-ping"));
    finishRun(db, "run_quick", "ok");

    const summaries = listLatestFinishedRunSummaries(db);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.run_id).toBe("run_quick");
    expect(summaries[0]?.scenario_count).toBe(3);

    const merged = mergedBenchDetailFromDb(db, "mx", "http://localhost:8080");
    expect(merged).not.toBeNull();
    expect(merged!.meta.run_id).toBe("run_quick");
    expect(merged!.scenarios).toHaveLength(3);

    const byId = Object.fromEntries(merged!.scenarios.map((s) => [s.id, s]));
    expect(byId.chat_ping?.runs[0]?.output_text).toBe("new-ping");
    expect(byId.chat_ping?.source_run_id).toBe("run_quick");
    expect(byId.chat_hello?.runs[0]?.output_text).toBe("old-hello");
    expect(byId.chat_hello?.source_run_id).toBe("run_full");
    expect(byId.vision_table_ocr_a?.source_run_id).toBe("run_full");
    expect(merged!.meta.scenario_ids).toEqual(
      expect.arrayContaining(["chat_hello", "chat_ping", "vision_table_ocr_a"]),
    );

    const fromRunId = mergedBenchDetailFromRunId(db, "run_quick");
    expect(fromRunId?.scenarios.map((s) => s.id).sort()).toEqual(
      merged!.scenarios.map((s) => s.id).sort(),
    );
  });

  it("keeps routes separate and falls back when newer run has empty runs", async () => {
    const db = openBenchDatabase(":memory:");
    const metaOld = makeBenchRunMeta(req("mx"), detect, "run_a");
    insertRun(db, {
      run_id: metaOld.run_id,
      created_at: metaOld.created_at,
      base_url: metaOld.base_url.replace(/\/+$/, ""),
      provider: metaOld.provider,
      model_id: metaOld.model_id,
      meta: metaOld,
      status: "running",
    });
    upsertScenarioAggregate(db, withRuns("run_a", "chat_ping", "chat-route", "chat_completions"));
    upsertScenarioAggregate(db, withRuns("run_a", "chat_ping", "msg-route", "messages"));
    finishRun(db, "run_a", "ok");

    await new Promise((r) => setTimeout(r, 30));

    const metaNew = makeBenchRunMeta(req("mx"), detect, "run_b");
    insertRun(db, {
      run_id: metaNew.run_id,
      created_at: metaNew.created_at,
      base_url: metaNew.base_url.replace(/\/+$/, ""),
      provider: metaNew.provider,
      model_id: metaNew.model_id,
      meta: metaNew,
      status: "running",
    });
    // 빈 runs → 이전 실측 폴백
    upsertScenarioAggregate(db, emptyRuns("run_b", "chat_ping", "chat_completions"));
    finishRun(db, "run_b", "partial");

    const merged = mergedBenchDetailFromDb(db, "mx", "http://localhost:8080/");
    expect(merged!.scenarios).toHaveLength(2);
    const chat = merged!.scenarios.find((s) => s.api_route === "chat_completions");
    const msg = merged!.scenarios.find((s) => s.api_route === "messages");
    expect(chat?.runs[0]?.output_text).toBe("chat-route");
    expect(chat?.source_run_id).toBe("run_a");
    expect(msg?.runs[0]?.output_text).toBe("msg-route");
    expect(msg?.source_run_id).toBe("run_a");
  });

  it("includes measured scenarios from cancelled finished runs", async () => {
    const db = openBenchDatabase(":memory:");
    const meta = makeBenchRunMeta(req("mx"), detect, "run_cancel");
    insertRun(db, {
      run_id: meta.run_id,
      created_at: meta.created_at,
      base_url: meta.base_url.replace(/\/+$/, ""),
      provider: meta.provider,
      model_id: meta.model_id,
      meta,
      status: "running",
    });
    upsertScenarioAggregate(db, withRuns("run_cancel", "chat_hello", "from-cancelled"));
    finishRun(db, "run_cancel", "cancelled");

    const merged = mergedBenchDetailFromDb(db, "mx", "http://localhost:8080");
    expect(merged!.scenarios).toHaveLength(1);
    expect(merged!.scenarios[0]?.runs[0]?.output_text).toBe("from-cancelled");
    expect(listLatestFinishedRunSummaries(db)[0]?.scenario_count).toBe(1);
  });
});
