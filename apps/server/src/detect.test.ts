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
              loaded_instances: [],
            },
          ],
        });
      }
      if (url.includes("/v1/chat/completions")) {
        return jsonResponse({ error: "bad model" }, 400);
      }
      if (url.includes("/v1/messages")) {
        return jsonResponse({ error: "bad model" }, 400);
      }
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:1234", { fetchImpl });
    expect(r.provider).toBe("lm_studio");
    expect(r.models[0]?.id).toBe("m1");
  });

  it("falls back to Ollama when LM list missing", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/tags")) {
        return jsonResponse({ models: [{ name: "llama3" }] });
      }
      if (url.includes("/v1/chat/completions")) return jsonResponse({ error: "x" }, 400);
      if (url.includes("/v1/messages")) return jsonResponse({ error: "x" }, 400);
      return jsonResponse({}, 404);
    });
    const r = await detectProvider("http://localhost:11434", { fetchImpl });
    expect(r.provider).toBe("ollama");
    expect(r.models[0]?.id).toBe("llama3");
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
  });
});
