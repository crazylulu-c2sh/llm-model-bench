import type { DetectResult, StreamEvent } from "@llm-bench/shared";
import { describe, expect, it, vi } from "vitest";
import { runBench, type BenchRequest } from "./bench-runner.js";
import { _resetStreamUsageCacheForTests } from "./openai-fetch.js";
import type { ContentionProbe } from "./contention-probe.js";

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function sseChatOk(): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"pong"}}]}\n\n'));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** 첫 청크 emit 후 abort될 때까지 열린 채로 대기하는 스트림 — 오염 abort 경로 테스트용. */
function sseHangingUntilAbort(signal?: AbortSignal): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"par"}}]}\n\n'));
      const close = () => {
        try {
          controller.close();
        } catch {
          /* 이미 닫힘 */
        }
      };
      if (signal?.aborted) close();
      else signal?.addEventListener("abort", close, { once: true });
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const MODEL_ID = "bench-model-a";

function detectOpenAi(): DetectResult {
  return {
    provider: "lm_studio",
    baseUrl: "http://127.0.0.1:1234/",
    models: [{ id: MODEL_ID }],
    steps: [],
    capabilities: { openaiChat: true, anthropicMessages: false },
  };
}

function req(overrides: Partial<BenchRequest> = {}): BenchRequest {
  return {
    baseUrl: "http://127.0.0.1:1234/",
    provider: "lm_studio",
    modelId: MODEL_ID,
    scenarioIds: ["chat_ping"],
    skipModelLoad: true,
    unloadOtherModels: false,
    warmupRuns: 0,
    measuredRuns: 1,
    parallel: false,
    ...overrides,
  };
}

function fakeClock() {
  const c = { ticks: 0 };
  return {
    now: () => c.ticks,
    sleep: async (ms: number) => {
      c.ticks += ms;
    },
  };
}

function fakeProbe(opts: {
  idleActiveSeq?: boolean[];
  inflightContendedSeq?: boolean[];
  hasActiveSignal?: boolean;
}): ContentionProbe {
  let idleI = 0;
  let inflightI = 0;
  const hasActiveSignal = opts.hasActiveSignal ?? true;
  return {
    async sampleIdle() {
      const active = opts.idleActiveSeq?.[idleI] ?? false;
      idleI++;
      return {
        active,
        reasons: active ? ["server_running=1 waiting=0"] : ["idle"],
        gpuUtilPct: null,
        gpuSignalAvailable: false,
        hasActiveSignal,
      };
    },
    async segmentBaseline() {
      return { loadedIds: [], expiresById: {} };
    },
    async sampleInFlight() {
      const c = opts.inflightContendedSeq?.[inflightI] ?? false;
      inflightI++;
      return { contended: c, reasons: c ? ["server_running=2 waiting=0"] : [] };
    },
  };
}

async function collect(
  request: BenchRequest,
  fetchImpl: typeof fetch,
  probe: ContentionProbe,
): Promise<StreamEvent[]> {
  _resetStreamUsageCacheForTests();
  const clock = fakeClock();
  const events: StreamEvent[] = [];
  for await (const ev of runBench(request, detectOpenAi(), {
    fetchImpl,
    probeImpl: probe,
    now: clock.now,
    sleep: clock.sleep,
  })) {
    events.push(ev);
  }
  return events;
}

function types(events: StreamEvent[]): string[] {
  return events.map((e) => e.type);
}

describe("runBench contention guard", () => {
  it("(1) clean run: idle gates, no in-flight contention → normal metrics_update, no contention events", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (requestUrl(input).endsWith("/v1/chat/completions")) return sseChatOk();
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const events = await collect(req(), fetchImpl, fakeProbe({}));
    const t = types(events);
    expect(t).toContain("metrics_update");
    expect(t).not.toContain("iteration_discarded");
    expect(t).not.toContain("contention_waiting");
    // 가드 활성 → 단일 contention_summary
    expect(t.filter((x) => x === "contention_summary")).toHaveLength(1);
  });

  it("(4) in-flight contention once → iteration discarded then clean retry, exactly 1 measured run", async () => {
    let chatCall = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestUrl(input).endsWith("/v1/chat/completions")) {
        chatCall++;
        return chatCall === 1 ? sseHangingUntilAbort(init?.signal ?? undefined) : sseChatOk();
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    // 첫 in-flight 폴 contended, 이후 clean.
    const events = await collect(req(), fetchImpl, fakeProbe({ inflightContendedSeq: [true] }));
    const discarded = events.filter((e) => e.type === "iteration_discarded");
    expect(discarded).toHaveLength(1);
    expect((discarded[0] as { will_retry: boolean }).will_retry).toBe(true);
    expect((discarded[0] as { measured_index: number }).measured_index).toBe(0);
    const mu = events.find((e) => e.type === "metrics_update") as
      | { aggregate: { runs: unknown[] } }
      | undefined;
    expect(mu).toBeTruthy();
    expect(mu!.aggregate.runs).toHaveLength(1); // 폐기분은 집계에 없음
  });

  it("(5) contention every attempt → max_retries_exceeded, no metrics_update for the scenario", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (requestUrl(input).endsWith("/v1/chat/completions")) {
        return sseHangingUntilAbort(init?.signal ?? undefined);
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const events = await collect(
      req({ contentionMaxRetriesPerIteration: 2 }),
      fetchImpl,
      fakeProbe({ inflightContendedSeq: [true, true, true, true] }),
    );
    const discarded = events.filter((e) => e.type === "iteration_discarded");
    expect(discarded).toHaveLength(3); // retry 0,1 (will_retry) + 2 (exhausted)
    expect((discarded[2] as { will_retry: boolean }).will_retry).toBe(false);
    const t = types(events);
    expect(events.some((e) => e.type === "error" && e.code === "contention_max_retries_exceeded")).toBe(true);
    expect(t).not.toContain("metrics_update");
    const summary = events.filter((e) => e.type === "contention_summary");
    expect(summary).toHaveLength(1);
    expect((summary[0] as { abort_reason?: string }).abort_reason).toBe("contention_max_retries_exceeded");
  });

  it("(3) pre-bench never idle → pre_bench_wait_timeout, no scenario_start/metrics_update", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    const events = await collect(
      req({ contentionPreBenchTimeoutMs: 2000, contentionPollIntervalMs: 1000 }),
      fetchImpl,
      fakeProbe({ idleActiveSeq: new Array(50).fill(true) }),
    );
    const t = types(events);
    expect(events.some((e) => e.type === "error" && e.code === "pre_bench_wait_timeout")).toBe(true);
    expect(t).not.toContain("scenario_start");
    expect(t).not.toContain("metrics_update");
    expect(events.filter((e) => e.type === "contention_summary")).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled(); // 요청 자체가 안 나감
  });

  it("(disabled) contentionGuardEnabled=false → no contention events at all", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (requestUrl(input).endsWith("/v1/chat/completions")) return sseChatOk();
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const events = await collect(
      req({ contentionGuardEnabled: false }),
      fetchImpl,
      fakeProbe({ inflightContendedSeq: [true, true] }),
    );
    const t = types(events);
    expect(t).toContain("metrics_update");
    expect(t).not.toContain("contention_summary");
    expect(t).not.toContain("iteration_discarded");
    expect(t).not.toContain("contention_waiting");
  });

  it("(12) warmup contention is ignored: monitor OFF during warmup, no discards", async () => {
    let chatCall = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (requestUrl(input).endsWith("/v1/chat/completions")) {
        chatCall++;
        return sseChatOk();
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    // probe would report contention, but warmup must not arm the monitor.
    const events = await collect(
      req({ warmupRuns: 1, measuredRuns: 1 }),
      fetchImpl,
      // first inflight sample (if monitor ran in warmup) would be true; ensure measured stays clean.
      fakeProbe({ inflightContendedSeq: [false, false, false] }),
    );
    const t = types(events);
    expect(t).toContain("metrics_update");
    expect(t).not.toContain("iteration_discarded");
    expect(chatCall).toBe(2); // warmup + measured both issued requests
  });
});
