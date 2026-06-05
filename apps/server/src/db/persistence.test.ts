import type { DetectResult, StreamEvent } from "@llm-bench/shared";
import { describe, expect, it } from "vitest";
import { makeBenchRunMeta, type BenchRequest } from "../bench-runner.js";
import { finishRun, insertRun, latestFinishedRunsByModels, openBenchDatabase } from "./database.js";
import { BenchRunPersistence } from "./persist-stream.js";
import { benchResultDetailFromDb } from "./run-queries.js";

const detect: DetectResult = {
  provider: "openai_compatible",
  baseUrl: "http://localhost:8080/",
  models: [{ id: "m-a" }, { id: "m-b" }],
  steps: [],
  capabilities: { openaiChat: true, anthropicMessages: false },
};

function req(modelId: string): BenchRequest {
  return {
    baseUrl: detect.baseUrl,
    provider: detect.provider,
    modelId,
    parallel: false,
    skipModelLoad: true,
  };
}

describe("BenchRunPersistence + sqlite", () => {
  it("stores meta, metrics_update aggregate, and text logs", () => {
    const db = openBenchDatabase(":memory:");
    const p = new BenchRunPersistence(db);
    const meta = makeBenchRunMeta(req("m-a"), detect, "run_test_1");
    p.start(meta);
    p.onEvent({
      type: "scenario_start",
      scenario_id: "chat_ping",
      api_route: "chat_completions",
      system_prompt: "exact-system-prompt-snapshot",
      user_prompt: "exact-user-prompt-snapshot",
    });
    const ev: StreamEvent = {
      type: "metrics_update",
      aggregate: {
        scenario_id: "chat_ping",
        api_route: "chat_completions",
        runs: [
          {
            ttft_ms: 10,
            total_ms: 100,
            output_text: "pong",
            stream_completed: true,
            quality: { pass: true },
          },
        ],
      },
    };
    p.onEvent(ev);
    p.finalize();

    const detail = benchResultDetailFromDb(db, "run_test_1");
    expect(detail?.meta.model_id).toBe("m-a");
    expect(detail?.scenarios.length).toBe(1);
    expect(detail?.scenarios[0].id).toBe("chat_ping");
    expect(detail?.scenarios[0].runs[0]?.output_text).toBe("pong");
    expect(detail?.scenarios[0].prompt_system_preview).toBe("exact-system-prompt-snapshot");
    expect(detail?.scenarios[0].prompt_preview).toBe("exact-user-prompt-snapshot");
  });

  it("latestFinishedRunsByModels returns newest finished run per model", async () => {
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

    const map = latestFinishedRunsByModels(db, "http://localhost:8080", ["mx"]);
    expect(map.get("mx")?.run_id).toBe(meta2.run_id);
  });
});
