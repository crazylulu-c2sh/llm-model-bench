import type { DetectResult } from "@llm-bench/shared";
import { describe, expect, it, vi } from "vitest";
import { runBench, type BenchRequest } from "./bench-runner.js";

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
    parallel: false,
    ...overrides,
  };
}

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
