import { describe, expect, it } from "vitest";
import type { DetectResult } from "@llm-bench/shared";
import { makeBenchRunMeta, type BenchRequest } from "./bench-runner.js";
import { benchSettingsCanonical } from "./bench-config.js";
import {
  measuredKeysFromMerged,
  planGapFill,
  splitCoveredScenarioIds,
} from "./bench-gap-fill.js";
import {
  finishRun,
  insertRun,
  openBenchDatabase,
  upsertScenarioAggregate,
} from "./db/database.js";
import { benchRequestForQueueModel, type BenchQueueBaseRequest } from "./bench-queue-runner.js";

const detect: DetectResult = {
  provider: "openai_compatible",
  baseUrl: "http://localhost:8080/",
  models: [{ id: "mx" }, { id: "openai/gpt-oss-20b" }, { id: "Qwen/Qwen3.8-27B" }],
  steps: [],
  capabilities: { openaiChat: true, anthropicMessages: true },
};

function withRuns(runId: string, scenarioId: string, apiRoute = "chat_completions") {
  return {
    run_id: runId,
    scenario_id: scenarioId,
    api_route: apiRoute,
    aggregate_json: JSON.stringify({
      scenario_id: scenarioId,
      api_route: apiRoute,
      runs: [{ ttft_ms: 1, total_ms: 10, output_text: "ok", stream_completed: true }],
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

const base: BenchQueueBaseRequest = {
  baseUrl: detect.baseUrl,
  provider: detect.provider,
  scenarioIds: ["chat_hello", "chat_ping"],
  skipModelLoad: true,
};

function queueReq(
  modelId: string,
  over: Partial<BenchQueueBaseRequest> = {},
  intent: Parameters<typeof benchRequestForQueueModel>[2] = {},
): BenchRequest {
  return benchRequestForQueueModel({ ...base, ...over }, modelId, intent);
}

function seedRun(
  db: ReturnType<typeof openBenchDatabase>,
  input: BenchRequest,
  runId: string,
  scenarios: Array<{ id: string; api?: string; empty?: boolean }>,
) {
  const meta = makeBenchRunMeta(input, detect, runId);
  insertRun(db, {
    run_id: meta.run_id,
    created_at: meta.created_at,
    base_url: meta.base_url.replace(/\/+$/, ""),
    provider: meta.provider,
    model_id: meta.model_id,
    meta,
    status: "running",
  });
  for (const s of scenarios) {
    const api = s.api ?? "chat_completions";
    upsertScenarioAggregate(
      db,
      s.empty ? emptyRuns(meta.run_id, s.id, api) : withRuns(meta.run_id, s.id, api),
    );
  }
  finishRun(db, meta.run_id, "ok");
}

describe("splitCoveredScenarioIds", () => {
  it("requires every selected API route before marking a scenario covered", () => {
    const measured = new Set(["chat_hello|chat_completions"]);
    expect(
      splitCoveredScenarioIds(["chat_hello", "chat_ping"], ["chat_completions", "messages"], measured),
    ).toEqual({
      missing: ["chat_hello", "chat_ping"],
      covered: [],
    });
    measured.add("chat_hello|messages");
    expect(
      splitCoveredScenarioIds(["chat_hello", "chat_ping"], ["chat_completions", "messages"], measured),
    ).toEqual({
      missing: ["chat_ping"],
      covered: ["chat_hello"],
    });
  });

  it("treats empty apiRoutes as all missing", () => {
    expect(splitCoveredScenarioIds(["chat_hello"], [], new Set(["chat_hello|chat_completions"]))).toEqual({
      missing: ["chat_hello"],
      covered: [],
    });
  });
});

describe("measuredKeysFromMerged", () => {
  it("skips empty runs", () => {
    expect(
      measuredKeysFromMerged({
        scenarios: [
          { id: "chat_hello", api_route: "chat_completions", runs: [{ ttft_ms: 1 }] },
          { id: "chat_ping", api_route: "chat_completions", runs: [] },
        ],
      }),
    ).toEqual(new Set(["chat_hello|chat_completions"]));
  });
});

describe("planGapFill", () => {
  it("treats no DB rows as all selected scenarios missing", () => {
    const db = openBenchDatabase(":memory:");
    const plan = planGapFill({
      db,
      detect,
      base,
      intent: {},
      modelIds: ["mx"],
    });
    expect(plan.runnableModelIds).toEqual(["mx"]);
    expect(plan.scenarioIdsByModel.mx).toEqual(expect.arrayContaining(["chat_hello", "chat_ping"]));
    expect(plan.models[0]?.covered_scenario_ids).toEqual([]);
  });

  it("skips a model whose current config already covers the selection", () => {
    const db = openBenchDatabase(":memory:");
    seedRun(db, queueReq("mx", { apiRoutes: ["chat_completions"] }), "run_full", [
      { id: "chat_hello" },
      { id: "chat_ping" },
    ]);
    const plan = planGapFill({
      db,
      detect: { ...detect, capabilities: { openaiChat: true, anthropicMessages: false } },
      base: { ...base, apiRoutes: ["chat_completions"] },
      intent: {},
      modelIds: ["mx"],
    });
    expect(plan.runnableModelIds).toEqual([]);
    expect(plan.models[0]?.missing_scenario_ids).toEqual([]);
    expect(plan.models[0]?.covered_scenario_ids).toEqual(["chat_hello", "chat_ping"]);
  });

  it("re-runs scenarios that exist only under an older config_id", () => {
    const db = openBenchDatabase(":memory:");
    const oldReq = queueReq("mx", { apiRoutes: ["chat_completions"] }, { thinkingIntent: "off" });
    seedRun(db, oldReq, "run_old", [{ id: "chat_hello" }, { id: "chat_ping" }]);
    const currentMeta = makeBenchRunMeta(queueReq("mx", { apiRoutes: ["chat_completions"] }), detect, "plan");
    const oldMeta = makeBenchRunMeta(oldReq, detect, "run_old");
    expect(benchSettingsCanonical(currentMeta)).not.toBe(benchSettingsCanonical(oldMeta));

    const plan = planGapFill({
      db,
      detect: { ...detect, capabilities: { openaiChat: true, anthropicMessages: false } },
      base: { ...base, apiRoutes: ["chat_completions"] },
      intent: {},
      modelIds: ["mx"],
    });
    expect(plan.runnableModelIds).toEqual(["mx"]);
    expect(plan.scenarioIdsByModel.mx).toEqual(["chat_hello", "chat_ping"]);
  });

  it("treats empty runs as missing", () => {
    const db = openBenchDatabase(":memory:");
    seedRun(db, queueReq("mx", { apiRoutes: ["chat_completions"] }), "run_fail", [
      { id: "chat_hello" },
      { id: "chat_ping", empty: true },
    ]);
    const plan = planGapFill({
      db,
      detect: { ...detect, capabilities: { openaiChat: true, anthropicMessages: false } },
      base: { ...base, apiRoutes: ["chat_completions"] },
      intent: {},
      modelIds: ["mx"],
    });
    expect(plan.scenarioIdsByModel.mx).toEqual(["chat_ping"]);
    expect(plan.models[0]?.covered_scenario_ids).toEqual(["chat_hello"]);
  });

  it("marks a scenario missing when only one of two selected routes is measured", () => {
    const db = openBenchDatabase(":memory:");
    seedRun(db, queueReq("mx", { apiRoutes: ["chat_completions", "messages"] }), "run_one_route", [
      { id: "chat_hello", api: "chat_completions" },
      { id: "chat_hello", api: "messages" },
      { id: "chat_ping", api: "chat_completions" },
    ]);
    const plan = planGapFill({
      db,
      detect,
      base: { ...base, apiRoutes: ["chat_completions", "messages"] },
      intent: {},
      modelIds: ["mx"],
    });
    expect(plan.scenarioIdsByModel.mx).toEqual(["chat_ping"]);
    expect(plan.models[0]?.covered_scenario_ids).toEqual(["chat_hello"]);
  });

  it("computes config_id per model so mixed-family queues do not share coverage", () => {
    const db = openBenchDatabase(":memory:");
    const gpt = "openai/gpt-oss-20b";
    const qwen = "Qwen/Qwen3.8-27B";
    const intent = {
      profileId: "auto" as const,
      thinkingIntent: "on" as const,
      reasoningEffort: "high" as const,
      qwen38ReasoningEffort: "xhigh" as const,
    };
    const chatBase: BenchQueueBaseRequest = { ...base, apiRoutes: ["chat_completions"] };
    seedRun(db, benchRequestForQueueModel(chatBase, gpt, intent), "run_gpt", [
      { id: "chat_hello" },
      { id: "chat_ping" },
    ]);
    const chatOnly = { ...detect, capabilities: { openaiChat: true, anthropicMessages: false } };
    const plan = planGapFill({
      db,
      detect: chatOnly,
      base: chatBase,
      intent,
      modelIds: [gpt, qwen],
    });
    expect(plan.runnableModelIds).toEqual([qwen]);
    expect(plan.models.find((m) => m.model_id === gpt)?.missing_scenario_ids).toEqual([]);
    expect(plan.models.find((m) => m.model_id === qwen)?.missing_scenario_ids).toEqual(["chat_hello", "chat_ping"]);
  });
});
