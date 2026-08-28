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
              publisher: "unsloth",
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
    expect(r.models[0]?.publisher).toBe("unsloth");
    expect(r.models[0]?.size_bytes).toBe(4_000_000_000);
    expect(r.models[0]?.params_string).toBe("7B");
    expect(r.capabilities.openaiChat).toBe(true);
    expect(r.capabilities.anthropicMessages).toBe(true);
    expect(r.reachability?.state).toBe("ok");
  });

  it("filters imatrix / MTP draft / mmproj artifacts from LM Studio list", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [
            {
              key: "qwen3.8-27b@?",
              type: "llm",
              display_name: "Imatrix Unsloth",
              loaded_instances: [],
            },
            {
              key: "qwen3.8-27b@q4_0",
              type: "llm",
              display_name: "Mtp Qwen3.8 27B",
              loaded_instances: [],
            },
            {
              key: "mmproj-F16",
              type: "llm",
              display_name: "mmproj F16",
              loaded_instances: [],
            },
            {
              key: "qwen3.8-27b@iq1_s",
              type: "llm",
              display_name: "Qwen3.8 27B UD",
              loaded_instances: [],
            },
            {
              key: "qwen3.6-35b-a3b-mtp@q4_k_m",
              type: "llm",
              display_name: "Qwen3.6 35B A3B UD",
              loaded_instances: [],
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.models.map((m) => m.id)).toEqual([
      "qwen3.8-27b@iq1_s",
      "qwen3.6-35b-a3b-mtp@q4_k_m",
    ]);
  });

  it("falls back to org/ prefix when LM Studio omits publisher", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [
            {
              key: "qwen/qwen3.8-27b",
              type: "llm",
              display_name: "Qwen3.8 27B",
              loaded_instances: [],
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.provider).toBe("lm_studio");
    expect(r.models[0]?.publisher).toBe("qwen");
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

  it("keeps the transport error code so firewall/permission failures stay distinguishable", async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new TypeError("fetch failed");
      (e as { cause?: unknown }).cause = { code: "EHOSTUNREACH", syscall: "connect" };
      return Promise.reject(e);
    });
    const r = await detectProvider("http://192.168.0.9:11234", { fetchImpl });
    expect(r.reachability?.state).toBe("unreachable");
    expect(r.reachability?.reason).toContain("EHOSTUNREACH");
  });

  it("stops probing once the origin is proven dead", async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new TypeError("fetch failed");
      (e as { cause?: unknown }).cause = { code: "ECONNREFUSED" };
      return Promise.reject(e);
    });
    const r = await detectProvider("http://localhost:59999", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.steps).toHaveLength(1);
    expect(r.capabilities).toEqual({ openaiChat: false, anthropicMessages: false });
    expect(r.reachability?.state).toBe("unreachable");
  });

  it("bounds every request so an unresponsive host cannot stall detection", async () => {
    const signals: unknown[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return jsonResponse({}, 404);
    });
    await detectProvider("http://localhost:8000", { fetchImpl, timeoutMs: 1_000 });
    expect(signals).toHaveLength(5);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });

  it("does not claim LM Studio when a 200 body carries no models array", async () => {
    // LM Studio는 모르는 경로에도 200 + {"error":…}를 준다.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/v1/models") && !url.includes("/api/"))
        return jsonResponse({ data: [{ id: "m1" }] });
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      return jsonResponse({ error: "Unexpected endpoint or method." }, 200);
    });
    const r = await detectProvider("http://localhost:11234", { fetchImpl });
    expect(r.provider).toBe("openai_compatible");
    expect(r.models.map((m) => m.id)).toEqual(["m1"]);
    expect(r.steps.find((s) => s.name === "lm_studio_list")?.detail).toBe(
      "unrecognized_model_shape",
    );
  });

  it("normalizes LM Studio's own /api/v1 base back to the server root", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(requestUrl(input));
      if (requestUrl(input).endsWith("/api/v1/models"))
        return jsonResponse({ models: [{ key: "m1", type: "llm", display_name: "M1" }] });
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:11234/api/v1", { fetchImpl });
    expect(r.baseUrl).toBe("http://localhost:11234");
    expect(seen[0]).toBe("http://localhost:11234/api/v1/models");
    expect(r.provider).toBe("lm_studio");
    expect(r.models[0]?.id).toBe("m1");
  });

  it("treats an uppercase scheme as a scheme instead of a hostname", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(requestUrl(input));
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("HTTP://localhost:1234", { fetchImpl });
    expect(r.baseUrl).toBe("http://localhost:1234");
    expect(seen[0]).toBe("http://localhost:1234/api/v1/models");
  });

  it("keeps a body-parse failure from being misread as partial reachability", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return textResponse("<html>not json</html>", 200);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:8000", { fetchImpl });
    expect(r.steps.filter((s) => s.name === "lm_studio_list")).toHaveLength(1);
    expect(r.steps.find((s) => s.name === "lm_studio_list")?.detail).toBe("invalid_json");
    expect(r.reachability?.state).toBe("ok");
  });

  it("drops an embedding-only LM Studio list instead of resurrecting the filtered model", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models"))
        return jsonResponse({
          models: [{ key: "text-embedding-nomic", type: "embedding", display_name: "Nomic" }],
        });
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.provider).toBe("lm_studio");
    expect(r.models).toEqual([]);
    expect(r.steps.find((s) => s.name === "lm_studio_list")?.detail).toBe("no_benchable_model");
  });
});
