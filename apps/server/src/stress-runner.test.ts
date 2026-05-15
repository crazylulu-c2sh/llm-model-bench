import type { DetectResult, StressStreamEvent } from "@llm-bench/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetStreamUsageCacheForTests } from "./openai-fetch.js";
import { runStress, type StressRequest } from "./stress-runner.js";

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function sseChatStreamingResponse(opts: { contentChunks: string[]; usageCompletionTokens?: number }): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of opts.contentChunks) {
        controller.enqueue(
          enc.encode(`data: {"choices":[{"delta":{"content":${JSON.stringify(c)}}}]}\n\n`),
        );
      }
      if (typeof opts.usageCompletionTokens === "number") {
        controller.enqueue(
          enc.encode(
            `data: {"choices":[],"usage":{"completion_tokens":${opts.usageCompletionTokens},"prompt_tokens":3,"total_tokens":10}}\n\n`,
          ),
        );
      }
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function openaiDetect(): DetectResult {
  return {
    provider: "openai_compatible",
    baseUrl: "http://test-stress",
    models: [{ id: "m1" }],
    steps: [],
    capabilities: { openaiChat: true, anthropicMessages: false },
  };
}

const MIN_DURATION = 200;

function baseStressRequest(overrides: Partial<StressRequest> = {}): StressRequest {
  return {
    baseUrl: "http://test-stress",
    provider: "openai_compatible",
    modelId: "m1",
    workloadId: "stress_ping",
    ramp: { start: 1, max: 2, step: 1, durationMs: MIN_DURATION },
    workerPromptSuffix: false,
    requestTimeoutMs: 5000,
    temperature: 0,
    ...overrides,
  };
}

beforeEach(() => _resetStreamUsageCacheForTests());

describe("runStress basic ramp", () => {
  it("emits run_started → stage_started → worker events → stage_finished → run_finished", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/v1/chat/completions")) {
        return sseChatStreamingResponse({
          contentChunks: ["he", "llo"],
          usageCompletionTokens: 5,
        });
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    }) as unknown as typeof fetch;

    const types: StressStreamEvent["type"][] = [];
    const stageFinished: { stage_index: number; concurrency: number; tps_source: string }[] = [];
    for await (const ev of runStress(baseStressRequest(), openaiDetect(), { fetchImpl, tickIntervalMs: 5_000, maxRequestsPerWorker: 2 })) {
      types.push(ev.type);
      if (ev.type === "stress_stage_finished") {
        stageFinished.push({
          stage_index: ev.result.stage_index,
          concurrency: ev.result.concurrency,
          tps_source: ev.result.tps_source,
        });
      }
    }
    expect(types[0]).toBe("run_started");
    expect(types).toContain("stress_stage_started");
    expect(types).toContain("stress_worker_request_start");
    expect(types).toContain("stress_worker_token_delta");
    expect(types).toContain("stress_worker_request_end");
    expect(types).toContain("stress_stage_finished");
    expect(types[types.length - 1]).toBe("run_finished");
    // 2 stages expected (concurrency 1 then 2)
    expect(stageFinished.map((s) => s.concurrency)).toEqual([1, 2]);
    expect(stageFinished.every((s) => s.tps_source === "usage")).toBe(true);
  });

  it("falls back to approx token count when provider omits usage", async () => {
    const fetchImpl = vi.fn(async () =>
      sseChatStreamingResponse({ contentChunks: ["abcd"] }),
    ) as unknown as typeof fetch;

    let stage: StressStreamEvent | null = null;
    for await (const ev of runStress(
      baseStressRequest({ ramp: { start: 1, max: 1, step: 1, durationMs: MIN_DURATION } }),
      openaiDetect(),
      { fetchImpl, tickIntervalMs: 5_000, maxRequestsPerWorker: 3 },
    )) {
      if (ev.type === "stress_stage_finished") stage = ev;
    }
    expect(stage).not.toBeNull();
    if (stage && stage.type === "stress_stage_finished") {
      expect(stage.result.tps_source).toBe("approx");
    }
  });
});

describe("runStress unreliable flag", () => {
  it("marks aggregate_tps null when too few successes", async () => {
    // 1초 duration & no workers should manage many ping/sec — but our mock returns instantly
    // so we expect many successes. To force low success count, return 500s.
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "boom" }, 500)) as unknown as typeof fetch;
    let stage: StressStreamEvent | null = null;
    for await (const ev of runStress(
      baseStressRequest({ ramp: { start: 1, max: 1, step: 1, durationMs: MIN_DURATION } }),
      openaiDetect(),
      { fetchImpl, tickIntervalMs: 5_000, maxRequestsPerWorker: 3 },
    )) {
      if (ev.type === "stress_stage_finished") stage = ev;
    }
    expect(stage).not.toBeNull();
    if (stage && stage.type === "stress_stage_finished") {
      expect(stage.result.aggregate_tps).toBeNull();
      expect(stage.result.tps_unreliable).toBe(true);
      expect(stage.result.requests_succeeded).toBe(0);
      expect(stage.result.error_rate).toBeGreaterThan(0);
    }
  });
});

describe("runStress abort", () => {
  it("stops emitting stages once externalSignal aborts mid-run", async () => {
    const controller = new AbortController();
    // 워커 한 요청당 약간의 지연을 주어 abort가 단계 사이에서 발화하도록 함.
    const fetchImpl = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return sseChatStreamingResponse({ contentChunks: ["x"], usageCompletionTokens: 1 });
    }) as unknown as typeof fetch;

    const stagesSeen: number[] = [];
    // 단계 duration 500ms × 3단계 → 약 1.5s. abort at 200ms.
    setTimeout(() => controller.abort(), 200);
    for await (const ev of runStress(
      baseStressRequest({ ramp: { start: 1, max: 3, step: 1, durationMs: 500 } }),
      openaiDetect(),
      { fetchImpl, signal: controller.signal, tickIntervalMs: 5_000 },
    )) {
      if (ev.type === "stress_stage_finished") stagesSeen.push(ev.result.concurrency);
    }
    // 3개 단계 전부 완료되지 않아야 함 (적어도 0~2개)
    expect(stagesSeen.length).toBeLessThan(3);
  });
});

describe("runStress KO workload script_match", () => {
  it("computes script_match_rate when expected script is ko", async () => {
    const fetchImpl = vi.fn(async () =>
      sseChatStreamingResponse({ contentChunks: ["부하 테스트는 동시 처리량을 측정합니다."], usageCompletionTokens: 8 }),
    ) as unknown as typeof fetch;
    let stage: StressStreamEvent | null = null;
    for await (const ev of runStress(
      baseStressRequest({ workloadId: "stress_short_reply_ko", ramp: { start: 1, max: 1, step: 1, durationMs: MIN_DURATION } }),
      openaiDetect(),
      { fetchImpl, tickIntervalMs: 5_000, maxRequestsPerWorker: 3 },
    )) {
      if (ev.type === "stress_stage_finished") stage = ev;
    }
    expect(stage).not.toBeNull();
    if (stage && stage.type === "stress_stage_finished") {
      expect(stage.result.script_match_rate).not.toBeNull();
      expect((stage.result.script_match_rate ?? 0) > 0.5).toBe(true);
    }
  });
});
