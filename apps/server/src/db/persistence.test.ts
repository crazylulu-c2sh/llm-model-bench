import type { DetectResult, StreamEvent } from "@llm-bench/shared";
import { describe, expect, it } from "vitest";
import { makeBenchRunMeta, type BenchRequest } from "../bench-runner.js";
import {
  finishRun,
  getRunMetaJson,
  insertRun,
  latestFinishedRunsByModels,
  openBenchDatabase,
  updateRunMetaJson,
} from "./database.js";
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

  it("updateRunMetaJson merges a partial into meta_json (contention_summary patch)", () => {
    const db = openBenchDatabase(":memory:");
    const meta = makeBenchRunMeta(req("m-a"), detect, "run_patch");
    insertRun(db, {
      run_id: meta.run_id,
      created_at: meta.created_at,
      base_url: meta.base_url.replace(/\/+$/, ""),
      provider: meta.provider,
      model_id: meta.model_id,
      meta,
      status: "running",
    });
    // effective는 INSERT 시점 meta엔 없다.
    const before = JSON.parse(getRunMetaJson(db, meta.run_id)!) as Record<string, unknown>;
    expect(before.contention_summary).toBeUndefined();
    expect(before.model_id).toBe("m-a");

    const changed = updateRunMetaJson(db, meta.run_id, {
      contention_summary: { guard_effective: true, total_iterations_discarded: 2 },
    });
    expect(changed).toBe(1);

    const after = JSON.parse(getRunMetaJson(db, meta.run_id)!) as {
      model_id: string;
      contention_summary?: { guard_effective: boolean; total_iterations_discarded: number };
    };
    // 기존 필드 보존 + patch 머지
    expect(after.model_id).toBe("m-a");
    expect(after.contention_summary?.guard_effective).toBe(true);
    expect(after.contention_summary?.total_iterations_discarded).toBe(2);
  });

  it("updateRunMetaJson is a no-op for unknown run_id", () => {
    const db = openBenchDatabase(":memory:");
    expect(updateRunMetaJson(db, "nope", { x: 1 })).toBe(0);
  });
});
