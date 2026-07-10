import type { DetectResult } from "@llm-bench/shared";
import { DEFAULT_SCENARIO_IDS } from "@llm-bench/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBenchRunMeta, normalizeScenarioIdsForBench, runBench, type BenchRequest } from "./bench-runner.js";
import { _resetStreamUsageCacheForTests } from "./openai-fetch.js";
import type { ScenarioId } from "./scenarios.js";

function jsonResponse(obj: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

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

const MODEL_ID = "bench-model-a";

function lmStudioDetect(): DetectResult {
  return {
    provider: "lm_studio",
    baseUrl: "http://127.0.0.1:1234/",
    models: [{ id: MODEL_ID }],
    steps: [],
    capabilities: { openaiChat: true, anthropicMessages: false },
  };
}

function baseBenchRequest(overrides: Partial<BenchRequest> = {}): BenchRequest {
  return {
    baseUrl: "http://127.0.0.1:1234/",
    provider: "lm_studio",
    modelId: MODEL_ID,
    scenarioIds: ["chat_ping"],
    skipModelLoad: false,
    unloadOtherModels: false,
    warmupRuns: 0,
    measuredRuns: 1,
    // 이 스위트는 오염 가드 무관 동작을 검증 — 실제 GPU/lms probe로 인한 비결정성 차단.
    // (가드 자체는 bench-runner.contention.test.ts에서 결정적으로 검증.)
    contentionGuardEnabled: false,
    ...overrides,
  };
}

describe("makeBenchRunMeta default scenarioIds", () => {
  it("falls back to DEFAULT_SCENARIO_IDS (text 8, no vision_/stress_) when caller omits scenarioIds", () => {
    const meta = makeBenchRunMeta(
      { ...baseBenchRequest(), scenarioIds: undefined },
      lmStudioDetect(),
      "run_test_1",
    );
    expect(meta.scenario_ids).toHaveLength(DEFAULT_SCENARIO_IDS.length);
    expect(meta.scenario_ids.every((id) => !id.startsWith("stress_"))).toBe(true);
    expect(meta.scenario_ids.every((id) => !id.startsWith("vision_"))).toBe(true);
    expect(meta.scenario_ids).toContain("chat_ping");
    // 정렬 normalize (translate를 마지막으로) 후에도 동일한 8개 집합이 유지된다.
    expect(new Set(meta.scenario_ids)).toEqual(new Set(DEFAULT_SCENARIO_IDS));
  });

  it("silently drops stress_* ids if a client sends them", () => {
    const meta = makeBenchRunMeta(
      {
        ...baseBenchRequest(),
        scenarioIds: ["chat_ping", "stress_ping" as ScenarioId, "stress_short_reply_ko" as ScenarioId],
      },
      lmStudioDetect(),
      "run_test_2",
    );
    expect(meta.scenario_ids).toEqual(["chat_ping"]);
  });
});

describe("normalizeScenarioIdsForBench", () => {
  it("moves translate_nist_fips197_pdf_tools to the end while preserving other order", () => {
    const input: ScenarioId[] = [
      "translate_nist_fips197_pdf_tools",
      "chat_ping",
      "code_sort_js",
    ];
    expect(normalizeScenarioIdsForBench(input)).toEqual([
      "chat_ping",
      "code_sort_js",
      "translate_nist_fips197_pdf_tools",
    ]);
  });

  it("is a no-op when translate is absent", () => {
    const input: ScenarioId[] = ["chat_hello", "chat_ping"];
    expect(normalizeScenarioIdsForBench(input)).toEqual(input);
  });

  it("dedupes multiple translate entries to a single trailing id", () => {
    const input: ScenarioId[] = [
      "translate_nist_fips197_pdf_tools",
      "chat_ping",
      "translate_nist_fips197_pdf_tools",
    ];
    expect(normalizeScenarioIdsForBench(input)).toEqual([
      "chat_ping",
      "translate_nist_fips197_pdf_tools",
    ]);
  });
});

describe("runBench LM Studio autoUnloadAfterBench", () => {
  it("calls unload after run only when this bench performed a successful load", async () => {
    let postUnloadCount = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({
          models: [{ key: MODEL_ID, loaded_instances: [] }],
        });
      }
      if (url.endsWith("/api/v1/models/unload")) {
        postUnloadCount += 1;
        return jsonResponse({}, 200);
      }
      if (url.endsWith("/api/v1/models/load")) {
        return jsonResponse({}, 200);
      }
      if (url.endsWith("/v1/chat/completions")) {
        return sseChatOk();
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });

    const events: string[] = [];
    for await (const ev of runBench(
      baseBenchRequest({ autoUnloadAfterBench: true }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      events.push(ev.type);
    }

    expect(events).toContain("run_finished");
    expect(events.filter((t) => t === "model_unloaded")).toEqual(["model_unloaded"]);
    expect(postUnloadCount).toBe(2);
  });

  it("does not unload at end when the model was already loaded", async () => {
    let postUnloadCount = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({
          models: [{ key: MODEL_ID, loaded_instances: [{ id: "inst-1" }] }],
        });
      }
      if (url.endsWith("/api/v1/models/unload")) {
        postUnloadCount += 1;
        return jsonResponse({}, 200);
      }
      if (url.endsWith("/v1/chat/completions")) {
        return sseChatOk();
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });

    const events: string[] = [];
    for await (const ev of runBench(
      baseBenchRequest({ autoUnloadAfterBench: true }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      events.push(ev.type);
    }

    expect(events).toContain("run_finished");
    expect(events.filter((t) => t === "model_unloaded")).toEqual([]);
    expect(postUnloadCount).toBe(0);
  });

  it("skips end unload when autoUnloadAfterBench is false even if it loaded", async () => {
    let postUnloadCount = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({
          models: [{ key: MODEL_ID, loaded_instances: [] }],
        });
      }
      if (url.endsWith("/api/v1/models/unload")) {
        postUnloadCount += 1;
        return jsonResponse({}, 200);
      }
      if (url.endsWith("/api/v1/models/load")) {
        return jsonResponse({}, 200);
      }
      if (url.endsWith("/v1/chat/completions")) {
        return sseChatOk();
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });

    for await (const ev of runBench(
      baseBenchRequest({ autoUnloadAfterBench: false }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      if (ev.type === "run_finished") expect(ev.run_id).toMatch(/^run_/);
    }

    expect(postUnloadCount).toBe(1);
  });
});

describe("runBench OpenAI requests carry stream_options.include_usage", () => {
  it("includes stream_options for streaming chat completions and persists across runs", async () => {
    _resetStreamUsageCacheForTests();
    let sawStreamOptions = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [{ id: "i1" }] }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        const body = String(init?.body ?? "");
        if (body.includes("stream_options")) sawStreamOptions = true;
        return sseChatOk();
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    for await (const _ of runBench(baseBenchRequest(), lmStudioDetect(), { fetchImpl })) {
      void _;
    }
    expect(sawStreamOptions).toBe(true);
  });
});

describe("runBench wire — Qwen3.6 penalty/stop (Part 1+4 regression)", () => {
  it("sends repetition_penalty + presence_penalty + stop, and NO frequency_penalty", async () => {
    const qwenModel = "Qwen/Qwen3.6-35B-A3B";
    let captured: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({ models: [{ key: qwenModel, loaded_instances: [{ id: "i1" }] }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        captured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return sseChatOk();
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    for await (const _ of runBench(
      baseBenchRequest({
        modelId: qwenModel,
        scenarioIds: ["chat_ping"],
        skipModelLoad: true,
        profile: { profileId: "auto", taskMode: "general", thinkingIntent: "off" },
      }),
      { ...lmStudioDetect(), models: [{ id: qwenModel }] },
      { fetchImpl },
    )) {
      void _;
    }
    expect(captured).not.toBeNull();
    const body = captured as unknown as Record<string, unknown>;
    expect(body.repetition_penalty).toBe(1.0); // 모델카드 값(곱셈, off) 그대로
    expect(body.presence_penalty).toBe(1.5);
    expect("frequency_penalty" in body).toBe(false); // 더 이상 둔갑하지 않음
    expect(body.stop).toEqual(["<|im_end|>"]);
  });
});

// Section A — vision-specific behavior (D5/D7) and judge integration
describe("runBench vision D7 — warmup skips vision scenarios", () => {
  it("does not call upstream for vision scenario during warmup iterations", async () => {
    let chatCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [{ id: "i1" }] }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        chatCalls += 1;
        return sseChatOk();
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    for await (const _ of runBench(
      baseBenchRequest({
        scenarioIds: ["vision_chart_peak_a"],
        warmupRuns: 1,
        measuredRuns: 1,
      }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      void _;
    }
    // measured 1회만 호출되어야 한다 — warmup은 비전에서 스킵.
    expect(chatCalls).toBe(1);
  });
});

describe("runBench vision D5 — upstream_no_vision labelling", () => {
  it("labels quality when 400 body mentions image/vision/multimodal", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [{ id: "i1" }] }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        return new Response(
          "Error: this model does not support image input",
          { status: 400, headers: { "content-type": "text/plain" } },
        );
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    let labelled = false;
    for await (const ev of runBench(
      baseBenchRequest({
        scenarioIds: ["vision_chart_peak_a"],
        warmupRuns: 0,
        measuredRuns: 1,
      }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      if (ev.type === "scenario_end" && ev.quality?.reason?.startsWith("upstream_no_vision:")) {
        labelled = true;
        expect(ev.quality.pass).toBe(false);
        expect(ev.quality.score).toBe(0);
      }
    }
    expect(labelled).toBe(true);
  });

  it("does NOT label generic 400 without vision keywords", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [{ id: "i1" }] }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        return new Response("Error: rate limited", { status: 400 });
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    let labelled = false;
    for await (const ev of runBench(
      baseBenchRequest({
        scenarioIds: ["vision_chart_peak_a"],
        warmupRuns: 0,
        measuredRuns: 1,
      }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      if (ev.type === "scenario_end" && ev.quality?.reason?.startsWith("upstream_no_vision:")) {
        labelled = true;
      }
    }
    expect(labelled).toBe(false);
  });
});

describe("runBench scenario_start emits image_refs/image_delivery for vision", () => {
  it("includes image_refs (JPEG path) and image_delivery (base64 for loopback)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [{ id: "i1" }] }] });
      }
      if (url.endsWith("/v1/chat/completions")) return sseChatOk();
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    let sawImageRefs = false;
    let sawDelivery = false;
    for await (const ev of runBench(
      baseBenchRequest({
        scenarioIds: ["vision_chart_peak_a"],
        warmupRuns: 0,
        measuredRuns: 1,
      }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      if (ev.type === "scenario_start") {
        if (ev.image_refs && ev.image_refs[0]?.endsWith(".jpg")) sawImageRefs = true;
        if (ev.image_delivery === "base64") sawDelivery = true;
      }
    }
    expect(sawImageRefs).toBe(true);
    expect(sawDelivery).toBe(true);
  });
});

describe("runBench judge integration — 4 cases", () => {
  // 비전 meme/wireframe 시나리오에서 prefilter 통과 응답을 모킹해 judge 후처리를 검증.
  // chat_completions 응답이 prefilter 키워드를 모두 포함한 한국어 설명을 반환해야 함.
  const memePass = "이 밈은 데이터센터 서버 랙과 당나귀 수레의 대비로 기대와 현실의 차이를 풍자합니다.";

  function memeSseResponse(): Response {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          enc.encode(`data: {"choices":[{"delta":{"content":${JSON.stringify(memePass)}}}]}\n\n`),
        );
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  function judgeResponse(jsonBody: unknown): Response {
    return new Response(JSON.stringify(jsonBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  beforeEach(() => {
    delete process.env.LLM_JUDGE_ENABLED;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    delete process.env.LLM_JUDGE_ENABLED;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("judge disabled — prefilter passes, score capped at rubric 1 (pass=false)", async () => {
    let judgeCalled = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [{ id: "i1" }] }] });
      }
      if (url.endsWith("/v1/chat/completions")) return memeSseResponse();
      if (url.includes("api.anthropic.com")) judgeCalled = true;
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    let lastQuality: { pass: boolean; score?: number; reason?: string } | undefined;
    for await (const ev of runBench(
      baseBenchRequest({
        scenarioIds: ["vision_meme_explain_a"],
        warmupRuns: 0,
        measuredRuns: 1,
      }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      if (ev.type === "scenario_end") lastQuality = ev.quality;
    }
    expect(judgeCalled).toBe(false);
    expect(lastQuality?.pass).toBe(false);
    expect(lastQuality?.score).toBeCloseTo(0.33, 2);
    // 내부 플래그는 emit 직전 제거되어야 한다.
    expect((lastQuality as { judge_pending?: true })?.judge_pending).toBeUndefined();
  });

  it("judge enabled + rubric 3 — final pass=true score=1.0", async () => {
    process.env.LLM_JUDGE_ENABLED = "1";
    process.env.ANTHROPIC_API_KEY = "fake-test-key";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [{ id: "i1" }] }] });
      }
      if (url.endsWith("/v1/chat/completions")) return memeSseResponse();
      if (url.includes("api.anthropic.com")) {
        return judgeResponse({
          content: [{ type: "text", text: '{"score":3,"reason":"all elements covered"}' }],
        });
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    let lastQuality: { pass: boolean; score?: number; reason?: string } | undefined;
    for await (const ev of runBench(
      baseBenchRequest({
        scenarioIds: ["vision_meme_explain_a"],
        warmupRuns: 0,
        measuredRuns: 1,
      }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      if (ev.type === "scenario_end") lastQuality = ev.quality;
    }
    expect(lastQuality?.pass).toBe(true);
    expect(lastQuality?.score).toBeCloseTo(1, 5);
    expect(lastQuality?.reason).toMatch(/rubric=3/);
  });

  it("judge enabled + invalid JSON — judge_parse_error rubric 0", async () => {
    process.env.LLM_JUDGE_ENABLED = "1";
    process.env.ANTHROPIC_API_KEY = "fake-test-key";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [{ id: "i1" }] }] });
      }
      if (url.endsWith("/v1/chat/completions")) return memeSseResponse();
      if (url.includes("api.anthropic.com")) {
        // 응답에 JSON 객체가 없는 텍스트 → judge_parse_error
        return judgeResponse({ content: [{ type: "text", text: "Score: 3 (looks good)" }] });
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    let lastQuality: { pass: boolean; score?: number; reason?: string } | undefined;
    for await (const ev of runBench(
      baseBenchRequest({
        scenarioIds: ["vision_meme_explain_a"],
        warmupRuns: 0,
        measuredRuns: 1,
      }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      if (ev.type === "scenario_end") lastQuality = ev.quality;
    }
    expect(lastQuality?.pass).toBe(false);
    expect(lastQuality?.score).toBe(0);
    expect(lastQuality?.reason).toMatch(/judge_parse_error/);
  });

  it("judge enabled + HTTP error — judge_network_error rubric 0", async () => {
    process.env.LLM_JUDGE_ENABLED = "1";
    process.env.ANTHROPIC_API_KEY = "fake-test-key";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [{ id: "i1" }] }] });
      }
      if (url.endsWith("/v1/chat/completions")) return memeSseResponse();
      if (url.includes("api.anthropic.com")) {
        return new Response("internal error", { status: 500 });
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    let lastQuality: { pass: boolean; score?: number; reason?: string } | undefined;
    for await (const ev of runBench(
      baseBenchRequest({
        scenarioIds: ["vision_meme_explain_a"],
        warmupRuns: 0,
        measuredRuns: 1,
      }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      if (ev.type === "scenario_end") lastQuality = ev.quality;
    }
    expect(lastQuality?.pass).toBe(false);
    expect(lastQuality?.score).toBe(0);
    expect(lastQuality?.reason).toMatch(/judge_network_error|judge_http_500/);
  });
});

// Section B — vision default acts as floor (Math.max guard).
// We inspect the POST body to confirm the actual `max_tokens` sent upstream.
describe("runBench vision max_tokens — default as floor (B)", () => {
  function capturingFetchImpl(captured: { max_tokens?: number }) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [{ id: "i1" }] }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        try {
          const body = JSON.parse(String(init?.body ?? "{}")) as { max_tokens?: number };
          captured.max_tokens = body.max_tokens;
        } catch {
          /* ignore */
        }
        return sseChatOk();
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
  }

  it("vision default (2048) wins when no user override (request max_tokens unset)", async () => {
    const captured: { max_tokens?: number } = {};
    for await (const _ of runBench(
      baseBenchRequest({
        scenarioIds: ["vision_chart_peak_a"],
        warmupRuns: 0,
        measuredRuns: 1,
        // max_tokens unset → BenchRunMeta uses fallback 512; floor bumps to 2048
      }),
      lmStudioDetect(),
      { fetchImpl: capturingFetchImpl(captured) },
    )) {
      void _;
    }
    expect(captured.max_tokens).toBe(2048);
  });

  it("user max_tokens larger than vision default wins (4096 respected)", async () => {
    const captured: { max_tokens?: number } = {};
    for await (const _ of runBench(
      baseBenchRequest({
        scenarioIds: ["vision_chart_peak_a"],
        warmupRuns: 0,
        measuredRuns: 1,
        max_tokens: 4096,
      }),
      lmStudioDetect(),
      { fetchImpl: capturingFetchImpl(captured) },
    )) {
      void _;
    }
    expect(captured.max_tokens).toBe(4096);
  });

  it("user max_tokens smaller than vision default clamps up to default (256 → 2048)", async () => {
    const captured: { max_tokens?: number } = {};
    for await (const _ of runBench(
      baseBenchRequest({
        scenarioIds: ["vision_chart_peak_a"],
        warmupRuns: 0,
        measuredRuns: 1,
        max_tokens: 256,
      }),
      lmStudioDetect(),
      { fetchImpl: capturingFetchImpl(captured) },
    )) {
      void _;
    }
    expect(captured.max_tokens).toBe(2048);
  });
});

// Section C — truncated_at_max_tokens prefix on quality.reason.
describe("runBench truncation labelling (C)", () => {
  /** SSE with finish_reason="length" — simulates upstream cutting off at max_tokens. */
  function truncatedChatSse(): Response {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"thinking..."}}]}\n\n'));
        controller.enqueue(
          enc.encode('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'),
        );
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  it("prefixes quality.reason with truncated_at_max_tokens=N when finish_reason=length", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [{ id: "i1" }] }] });
      }
      if (url.endsWith("/v1/chat/completions")) return truncatedChatSse();
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    let lastQuality: { pass: boolean; score?: number; reason?: string } | undefined;
    for await (const ev of runBench(
      baseBenchRequest({
        scenarioIds: ["vision_chart_peak_a"],
        warmupRuns: 0,
        measuredRuns: 1,
      }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      if (ev.type === "scenario_end") lastQuality = ev.quality;
    }
    expect(lastQuality?.reason).toMatch(/^truncated_at_max_tokens=2048 \| /);
    // 잘림으로 JSON이 안 나왔으므로 rubric 0 + "no json object"가 prefix 뒤에 옴
    expect(lastQuality?.reason).toMatch(/no json object/);
    expect(lastQuality?.pass).toBe(false);
  });

  it("does NOT prefix when upstream_no_vision already labelled (negative case)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [{ id: "i1" }] }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        return new Response(
          "Error: this model does not support image input",
          { status: 400, headers: { "content-type": "text/plain" } },
        );
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    let lastQuality: { pass: boolean; score?: number; reason?: string } | undefined;
    for await (const ev of runBench(
      baseBenchRequest({
        scenarioIds: ["vision_chart_peak_a"],
        warmupRuns: 0,
        measuredRuns: 1,
      }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      if (ev.type === "scenario_end") lastQuality = ev.quality;
    }
    expect(lastQuality?.reason).toMatch(/^upstream_no_vision:/);
    expect(lastQuality?.reason).not.toMatch(/truncated_at_max_tokens/);
  });
});

describe("makeBenchRunMeta apiRoutes restriction (성능 측정 모드)", () => {
  function bothRoutesDetect(): DetectResult {
    return {
      provider: "lm_studio",
      baseUrl: "http://127.0.0.1:1234/",
      models: [{ id: MODEL_ID }],
      steps: [],
      capabilities: { openaiChat: true, anthropicMessages: true },
    };
  }
  it("restricts api_routes to the intersection when apiRoutes is given", () => {
    const meta = makeBenchRunMeta(
      baseBenchRequest({ apiRoutes: ["chat_completions"] }),
      bothRoutesDetect(),
      "rid_routes_1",
    );
    expect(meta.api_routes).toEqual(["chat_completions"]);
  });
  it("ignores apiRoutes (uses detected) when the intersection is empty", () => {
    const meta = makeBenchRunMeta(
      // messages 요청했지만 감지엔 chat만 → 교집합 비어 감지 라우트 유지
      baseBenchRequest({ apiRoutes: ["messages"] }),
      lmStudioDetect(),
      "rid_routes_2",
    );
    expect(meta.api_routes).toEqual(["chat_completions"]);
  });
  it("uses all detected routes when apiRoutes is omitted", () => {
    const meta = makeBenchRunMeta(baseBenchRequest(), bothRoutesDetect(), "rid_routes_3");
    expect(meta.api_routes).toEqual(["chat_completions", "messages"]);
  });
});

describe("runBench messages route — usage tokens + reasoning_hidden", () => {
  function messagesDetect(): DetectResult {
    return {
      provider: "lm_studio",
      baseUrl: "http://127.0.0.1:1234/",
      models: [{ id: MODEL_ID }],
      steps: [],
      capabilities: { openaiChat: false, anthropicMessages: true },
    };
  }
  /** 추론을 숨긴 채(텍스트만, thinking_delta 없음) 큰 usage.output_tokens를 보고하는 messages SSE. */
  function sseMessagesHiddenReasoning(visible: string, usageTokens: number): Response {
    const enc = new TextEncoder();
    const blocks = [
      `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(visible)}}}`,
      `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":${usageTokens}}}`,
      `event: message_stop\ndata: {"type":"message_stop"}`,
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const b of blocks) controller.enqueue(enc.encode(b + "\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  it("threads usage_output_tokens and flags reasoning_hidden when usage ≫ visible with no streamed thinking", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/v1/messages")) return sseMessagesHiddenReasoning("ok", 100);
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    let run: Record<string, unknown> | undefined;
    for await (const ev of runBench(
      baseBenchRequest({ skipModelLoad: true }),
      messagesDetect(),
      { fetchImpl },
    )) {
      if (ev.type === "metrics_update") {
        const agg = ev.aggregate as { runs?: Record<string, unknown>[] };
        run = agg.runs?.[agg.runs.length - 1];
      }
    }
    expect(run).toBeDefined();
    expect(run?.usage_output_tokens).toBe(100);
    expect(run?.reasoning_hidden).toBe(true);
  });

  it("does NOT flag reasoning_hidden when usage is close to the visible estimate", async () => {
    // 가시 텍스트 200자(approx 50토큰), usage 60 → 60 < 2*50 → 숨김 아님
    const big = "x".repeat(200);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/v1/messages")) return sseMessagesHiddenReasoning(big, 60);
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    let run: Record<string, unknown> | undefined;
    for await (const ev of runBench(
      baseBenchRequest({ skipModelLoad: true }),
      messagesDetect(),
      { fetchImpl },
    )) {
      if (ev.type === "metrics_update") {
        const agg = ev.aggregate as { runs?: Record<string, unknown>[] };
        run = agg.runs?.[agg.runs.length - 1];
      }
    }
    expect(run?.usage_output_tokens).toBe(60);
    expect(run?.reasoning_hidden).toBeUndefined();
  });
});

describe("runBench chat route — LM Studio engine-protocol regression flags", () => {
  /** chat_completions SSE: 각 원소를 `choices[0].delta`로 순서대로 흘리고 [DONE]으로 마감. */
  function sseChatDeltas(deltas: Record<string, unknown>[]): Response {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const d of deltas) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`));
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  async function lastRunFor(scenario: ScenarioId, resp: Response): Promise<Record<string, unknown> | undefined> {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/v1/chat/completions")) return resp;
      return jsonResponse({ error: "unexpected " + url }, 404);
    });
    let run: Record<string, unknown> | undefined;
    for await (const ev of runBench(
      baseBenchRequest({ skipModelLoad: true, scenarioIds: [scenario] }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      if (ev.type === "metrics_update") {
        const agg = ev.aggregate as { runs?: Record<string, unknown>[] };
        run = agg.runs?.[agg.runs.length - 1];
      }
    }
    return run;
  }

  it("flags reasoning_leaked_into_content when <think> appears in content with no reasoning_content", async () => {
    const run = await lastRunFor(
      "chat_ping",
      sseChatDeltas([{ content: "<think>secret reasoning</think>final answer" }]),
    );
    expect(run?.reasoning_leaked_into_content).toBe(true);
  });

  it("does NOT flag reasoning_leaked_into_content when reasoning arrives in reasoning_content", async () => {
    const run = await lastRunFor(
      "chat_ping",
      sseChatDeltas([{ reasoning_content: "thinking..." }, { content: "final answer" }]),
    );
    expect(run?.reasoning_leaked_into_content).toBeUndefined();
  });

  it("flags tool_call_args_corrupted when streamed tool arguments are concatenated (#1922)", async () => {
    const run = await lastRunFor(
      "tool_weather",
      sseChatDeltas([
        { tool_calls: [{ index: 0, id: "x", type: "function", function: { name: "get_weather", arguments: '{"a":1}' } }] },
        { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] },
      ]),
    );
    expect(run?.tool_call_args_corrupted).toBe(true);
  });
});

describe("runBench memory-fit preflight (#81)", () => {
  const GB = 1024 ** 3;
  function fakeSystem(freeGb: number) {
    return () => ({
      ts: "2026-07-10T00:00:00.000Z",
      totalMemBytes: 64 * GB,
      freeMemBytes: freeGb * GB,
      loadavg: [0, 0, 0] as [number, number, number],
      cpuCount: 8,
      platform: "linux",
    });
  }

  it("skip: records skipped_wont_fit + never calls upstream chat", async () => {
    let chatCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ models: [{ key: MODEL_ID, size_bytes: 26 * GB, loaded_instances: [] }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        chatCalls += 1;
        return sseChatOk();
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });

    const events: import("@llm-bench/shared").StreamEvent[] = [];
    for await (const ev of runBench(
      baseBenchRequest({ fitPolicy: "skip" }),
      lmStudioDetect(),
      { fetchImpl, systemInfoImpl: fakeSystem(14) },
    )) {
      events.push(ev);
    }

    const preflight = events.find((e) => e.type === "preflight_memory_fit");
    expect(preflight).toBeDefined();
    expect(preflight && preflight.type === "preflight_memory_fit" && preflight.action).toBe("skip");
    const err = events.find((e) => e.type === "error");
    expect(err && err.type === "error" && err.code).toBe("skipped_wont_fit");
    expect(events.some((e) => e.type === "run_finished")).toBe(true);
    expect(events.some((e) => e.type === "model_loaded")).toBe(false);
    expect(chatCalls).toBe(0);
  });

  it("unload_other_models: evicts resident (phase=preflight_fit) then loads and runs", async () => {
    const unloadedInstanceIds: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({
          models: [
            { key: MODEL_ID, size_bytes: 26 * GB, loaded_instances: [] },
            { key: "big-resident", size_bytes: 40 * GB, loaded_instances: [{ id: "big:1", ram_usage: 40 * GB }] },
          ],
        });
      }
      if (url.endsWith("/api/v1/models/unload")) {
        try {
          const body = init?.body ? (JSON.parse(String(init.body)) as { instance_id?: string }) : {};
          if (body.instance_id) unloadedInstanceIds.push(body.instance_id);
        } catch {
          /* ignore */
        }
        return jsonResponse({}, 200);
      }
      if (url.endsWith("/api/v1/models/load")) {
        return jsonResponse({}, 200);
      }
      if (url.endsWith("/v1/chat/completions")) {
        return sseChatOk();
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });

    const events: import("@llm-bench/shared").StreamEvent[] = [];
    for await (const ev of runBench(
      baseBenchRequest({ fitPolicy: "unload_other_models" }),
      lmStudioDetect(),
      { fetchImpl, systemInfoImpl: fakeSystem(14) },
    )) {
      events.push(ev);
    }

    const preflight = events.find((e) => e.type === "preflight_memory_fit");
    expect(preflight && preflight.type === "preflight_memory_fit" && preflight.action).toBe("unload_other_models");
    const preflightUnload = events.find(
      (e) => e.type === "model_unloaded" && e.phase === "preflight_fit",
    );
    expect(preflightUnload).toBeDefined();
    expect(preflightUnload && preflightUnload.type === "model_unloaded" && preflightUnload.model_id).toBe(
      "big-resident",
    );
    expect(unloadedInstanceIds).toContain("big:1"); // 실제 instance_id로 언로드
    expect(events.some((e) => e.type === "model_loaded")).toBe(true);
    expect(events.some((e) => e.type === "run_finished")).toBe(true);
  });

  it("unknown candidate size → proceeds to normal load (no skip)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [] }] }); // no size_bytes
      }
      if (url.endsWith("/api/v1/models/unload") || url.endsWith("/api/v1/models/load")) {
        return jsonResponse({}, 200);
      }
      if (url.endsWith("/v1/chat/completions")) {
        return sseChatOk();
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });

    const events: import("@llm-bench/shared").StreamEvent[] = [];
    for await (const ev of runBench(
      baseBenchRequest({ fitPolicy: "skip" }), // even with skip: unknown size never blocks
      lmStudioDetect(),
      { fetchImpl, systemInfoImpl: fakeSystem(1) },
    )) {
      events.push(ev);
    }
    const preflight = events.find((e) => e.type === "preflight_memory_fit");
    expect(preflight && preflight.type === "preflight_memory_fit" && preflight.size_source).toBe("unknown");
    expect(events.some((e) => e.type === "error" && e.code === "skipped_wont_fit")).toBe(false);
    expect(events.some((e) => e.type === "run_finished")).toBe(true);
  });
});

describe("runBench agent_loop scenario (#79)", () => {
  function sseTool(name: string): Response {
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(
            enc.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name, arguments: "{}" } }] } }] })}\n\n`,
            ),
          );
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  }
  function sseFinal(text: string): Response {
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  }

  it("runs agent_loop_mock_v1 end-to-end and records per-run agent metrics", async () => {
    // read_document → wiki_search → wiki_read → final JSON.
    const chatTurns = [
      sseTool("read_document"),
      sseTool("wiki_search"),
      sseTool("wiki_read"),
      sseFinal('{"title":"AES","summary":"symmetric cipher","sources":["aes"]}'),
    ];
    let chatIdx = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [] }] });
      }
      if (url.endsWith("/api/v1/models/load") || url.endsWith("/api/v1/models/unload")) {
        return jsonResponse({}, 200);
      }
      if (url.endsWith("/v1/chat/completions")) {
        return chatTurns[Math.min(chatIdx++, chatTurns.length - 1)]!;
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });

    let aggregate: { runs?: Array<Record<string, unknown>> } | null = null;
    const events: string[] = [];
    for await (const ev of runBench(
      baseBenchRequest({ scenarioIds: ["agent_loop_mock_v1"] as unknown as ScenarioId[] }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      events.push(ev.type);
      if (ev.type === "metrics_update") aggregate = ev.aggregate as { runs?: Array<Record<string, unknown>> };
    }

    expect(events).toContain("run_finished");
    expect(aggregate?.runs?.length).toBe(1);
    const run = aggregate!.runs![0]!;
    expect(run.agent_completion_reason).toBe("completed");
    expect(run.turns_to_completion).toBe(4);
    expect(run.empty_turn_count).toBe(0);
    expect(typeof run.valid_tool_call_rate).toBe("number");
    expect(run.valid_tool_call_rate).toBeCloseTo(3 / 4, 6); // 3 tool turns / 4 total
  });
});

describe("runBench custom single-turn scenario (#83)", () => {
  it("runs a registered custom scenario through the standard orchestrator (prompts/tools from registry)", async () => {
    const shared = await import("@llm-bench/shared");
    shared.registerScenarioDef(
      shared.ScenarioDefSchema.parse({
        id: "custom_single_turn_test",
        source: "custom",
        system: "CUSTOM-SYSTEM-PROMPT",
        user: "CUSTOM-USER-PROMPT",
        tools: [{ name: "lookup", parameters: { type: "object" } }],
        judge: { criterion: "score it", scale: "0-3" },
      }),
    );

    let chatBody: { messages?: Array<{ role: string; content?: unknown }>; tools?: unknown[] } = {};
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ models: [{ key: MODEL_ID, loaded_instances: [] }] });
      }
      if (url.endsWith("/api/v1/models/load") || url.endsWith("/api/v1/models/unload")) {
        return jsonResponse({}, 200);
      }
      if (url.endsWith("/v1/chat/completions")) {
        chatBody = JSON.parse(String(init?.body));
        return sseChatOk();
      }
      return jsonResponse({ error: "unexpected " + url }, 404);
    });

    let aggregate: { runs?: Array<Record<string, unknown>> } | null = null;
    const seenScenarioEnds: string[] = [];
    for await (const ev of runBench(
      baseBenchRequest({ scenarioIds: ["custom_single_turn_test"] as unknown as ScenarioId[] }),
      lmStudioDetect(),
      { fetchImpl },
    )) {
      if (ev.type === "scenario_end") seenScenarioEnds.push(ev.scenario_id);
      if (ev.type === "metrics_update") aggregate = ev.aggregate as { runs?: Array<Record<string, unknown>> };
    }

    // 커스텀 시스템/유저 프롬프트 + 도구가 레지스트리에서 요청 바디로 흘렀다.
    const sys = chatBody.messages?.find((m) => m.role === "system")?.content;
    expect(sys).toBe("CUSTOM-SYSTEM-PROMPT");
    expect(JSON.stringify(chatBody.tools ?? [])).toContain("lookup");
    // 시나리오가 실행되고 결과가 집계에 저장됨(judge 루브릭 → judge_pending → score 0.33).
    expect(seenScenarioEnds).toContain("custom_single_turn_test");
    expect(aggregate?.runs?.length).toBe(1);
    expect(aggregate!.runs![0]!.quality).toMatchObject({ score: 0.33 });

    shared.unregisterScenarioDef("custom_single_turn_test");
  });
});
