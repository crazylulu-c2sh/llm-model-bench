import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetStreamUsageCacheForTests,
  injectStreamUsage,
  looksLikeStreamUsageRejection,
  openAiChatPostWithUsage,
  shouldIncludeStreamUsage,
} from "./openai-fetch.js";

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

function emptyStreamResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("injectStreamUsage", () => {
  beforeEach(() => _resetStreamUsageCacheForTests());

  it("adds stream_options to streaming bodies", () => {
    const out = injectStreamUsage({ model: "x", stream: true }, "http://base");
    expect((out as { stream_options?: { include_usage: boolean } }).stream_options).toEqual({ include_usage: true });
  });

  it("skips injection when stream != true", () => {
    const out = injectStreamUsage({ model: "x" }, "http://base");
    expect((out as { stream_options?: unknown }).stream_options).toBeUndefined();
  });
});

describe("looksLikeStreamUsageRejection", () => {
  it("matches typical openai-compat 400 messages", () => {
    expect(looksLikeStreamUsageRejection(400, "unknown field: stream_options")).toBe(true);
    expect(looksLikeStreamUsageRejection(400, '{"error":"unknown parameter include_usage"}')).toBe(true);
  });

  it("does not match non-400 or unrelated bodies", () => {
    expect(looksLikeStreamUsageRejection(500, "unknown field: stream_options")).toBe(false);
    expect(looksLikeStreamUsageRejection(400, "model not loaded")).toBe(false);
  });
});

describe("openAiChatPostWithUsage", () => {
  beforeEach(() => _resetStreamUsageCacheForTests());

  it("retries without stream_options when first call 400s with hint", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      calls.push({ url, body });
      if (calls.length === 1) {
        return jsonResponse(400, '{"error":"unknown field: stream_options"}');
      }
      return emptyStreamResponse();
    }) as unknown as typeof fetch;
    const r = await openAiChatPostWithUsage(
      fetchImpl,
      "http://base/v1/chat/completions",
      "http://base",
      { "content-type": "application/json" },
      { model: "x", messages: [], stream: true },
    );
    expect(r.response.status).toBe(200);
    expect(r.retriedAfterStreamOptionsRejection).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toContain("stream_options");
    expect(calls[1].body).not.toContain("stream_options");
    // subsequent calls should skip injection for same base
    expect(shouldIncludeStreamUsage("http://base")).toBe(false);
  });

  it("does not retry when 400 body is unrelated", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, '{"error":"bad model"}')) as unknown as typeof fetch;
    const r = await openAiChatPostWithUsage(
      fetchImpl,
      "http://base/v1/chat/completions",
      "http://base",
      { "content-type": "application/json" },
      { model: "x", messages: [], stream: true },
    );
    expect(r.response.status).toBe(400);
    expect(r.retriedAfterStreamOptionsRejection).toBe(false);
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it("propagates 200 response on first try", async () => {
    const fetchImpl = vi.fn(async () => emptyStreamResponse()) as unknown as typeof fetch;
    const r = await openAiChatPostWithUsage(
      fetchImpl,
      "http://base/v1/chat/completions",
      "http://base",
      { "content-type": "application/json" },
      { model: "x", messages: [], stream: true },
    );
    expect(r.response.status).toBe(200);
    expect(r.retriedAfterStreamOptionsRejection).toBe(false);
    expect(r.usedStreamOptions).toBe(true);
  });
});
