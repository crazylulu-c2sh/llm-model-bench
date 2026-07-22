import { describe, expect, it, vi } from "vitest";
import { ollamaKeepAliveLoad } from "./ollama.js";

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

describe("ollamaKeepAliveLoad", () => {
  it("POSTs /api/generate with keep_alive '<seconds>s', empty prompt, stream:false", async () => {
    let url = "";
    let sent: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = requestUrl(input);
      sent = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      return jsonResponse({ done_reason: "load" });
    });
    const r = await ollamaKeepAliveLoad("http://localhost:11434", "llama3.1:8b", {
      ttlSeconds: 600,
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(url).toBe("http://localhost:11434/api/generate");
    expect(sent).toEqual({
      model: "llama3.1:8b",
      prompt: "",
      stream: false,
      keep_alive: "600s",
    });
  });

  it("strips trailing slash from baseUrl", async () => {
    let url = "";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      url = requestUrl(input);
      return jsonResponse({});
    });
    await ollamaKeepAliveLoad("http://localhost:11434/", "m", { ttlSeconds: 60, fetchImpl });
    expect(url).toBe("http://localhost:11434/api/generate");
  });

  it("is best-effort: returns ok:false instead of throwing on network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const r = await ollamaKeepAliveLoad("http://localhost:11434", "m", { ttlSeconds: 60, fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
  });
});
