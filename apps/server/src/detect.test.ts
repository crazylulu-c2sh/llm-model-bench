import { describe, expect, it, vi } from "vitest";
import { detectProvider } from "./detect.js";

function jsonResponse(obj: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function textResponse(body: string, status = 200) {
  return Promise.resolve(new Response(body, { status }));
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

describe("detectProvider", () => {
  it("detects LM Studio from /api/v1/models", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [
            {
              key: "m1",
              type: "llm",
              display_name: "M1",
              size_bytes: 4_000_000_000,
              params_string: "7B",
              loaded_instances: [],
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.provider).toBe("lm_studio");
    expect(r.models[0]?.id).toBe("m1");
    expect(r.models[0]?.size_bytes).toBe(4_000_000_000);
    expect(r.models[0]?.params_string).toBe("7B");
    expect(r.capabilities.openaiChat).toBe(true);
    expect(r.capabilities.anthropicMessages).toBe(true);
    expect(r.reachability?.state).toBe("ok");
  });

  it("normalizes trailing /v1 on base URL and still detects LM Studio", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [
            {
              key: "m1",
              type: "llm",
              display_name: "M1",
              loaded_instances: [],
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234/v1/", { fetchImpl });
    expect(r.baseUrl).toBe("http://localhost:1234");
    expect(r.provider).toBe("lm_studio");
    expect(r.models[0]?.id).toBe("m1");
  });

  it("falls back to Ollama when LM list missing", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) {
        return jsonResponse({ models: [{ name: "llama3", size: 2_000_000_000 }] });
      }
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:11434", { fetchImpl });
    expect(r.provider).toBe("ollama");
    expect(r.models[0]?.id).toBe("llama3");
    expect(r.models[0]?.size_bytes).toBe(2_000_000_000);
    expect(r.capabilities.openaiChat).toBe(true);
    expect(r.capabilities.anthropicMessages).toBe(false);
    expect(r.reachability?.state).toBe("ok");
  });

  it("falls back to OpenAI-compatible", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) {
        return jsonResponse({ data: [{ id: "gpt-test" }] });
      }
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    expect(r.provider).toBe("openai_compatible");
    expect(r.models[0]?.id).toBe("gpt-test");
    expect(r.capabilities.openaiChat).toBe(true);
    expect(r.capabilities.anthropicMessages).toBe(true);
    expect(r.reachability?.state).toBe("ok");
  });

  it("treats Ollama-style 404 JSON model-not-found as chat route available", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) {
        return jsonResponse({ data: [{ id: "gpt-test" }] });
      }
      if (url.includes("/v1/chat/completions")) {
        return jsonResponse({ error: { message: "model 'probe-model' not found" } }, 404);
      }
      if (url.includes("/v1/messages")) return textResponse("404 page not found", 404);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    expect(r.provider).toBe("openai_compatible");
    expect(r.capabilities.openaiChat).toBe(true);
    expect(r.capabilities.anthropicMessages).toBe(false);
  });

  it("treats plain 404 page-not-found as route unavailable", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) return jsonResponse({ data: [] }, 200);
      if (url.includes("/v1/chat/completions")) return textResponse("404 page not found", 404);
      if (url.includes("/v1/messages")) return textResponse("404 page not found", 404);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    expect(r.provider).toBe("manual");
    expect(r.capabilities.openaiChat).toBe(false);
    expect(r.capabilities.anthropicMessages).toBe(false);
  });

  it("treats empty LM Studio /api/v1/models as lm_studio with zero models", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({ models: [] });
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.provider).toBe("lm_studio");
    expect(r.models).toEqual([]);
    expect(r.steps.find((s) => s.name === "lm_studio_list")?.detail).toBe("empty_model_list");
    expect(r.capabilities.openaiChat).toBe(true);
    expect(r.capabilities.anthropicMessages).toBe(true);
    expect(r.reachability?.state).toBe("ok");
  });

  it("reports unreachable when all model list requests fail at network layer", async () => {
    const fetchImpl = vi.fn(async () => Promise.reject(new TypeError("fetch failed")));
    const r = await detectProvider("http://localhost:59999", { fetchImpl });
    expect(r.reachability?.ok).toBe(false);
    expect(r.reachability?.state).toBe("unreachable");
    expect(r.provider).toBe("manual");
    expect(r.models).toEqual([]);
  });

  it("reports partial reachability when one list path throws and others respond", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return Promise.reject(new TypeError("fetch failed"));
      if (url.endsWith("/api/tags")) return jsonResponse({}, 404);
      if (url.endsWith("/v1/models")) return jsonResponse({ data: [] }, 200);
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    expect(r.reachability?.state).toBe("partial");
    expect(r.provider).toBe("manual");
    expect(r.models).toEqual([]);
  });
});
