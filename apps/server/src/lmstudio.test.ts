import { describe, expect, it, vi } from "vitest";
import { lmStudioIsModelLoaded } from "./lmstudio.js";

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

describe("lmStudioIsModelLoaded", () => {
  it("returns loaded=true when target key has loaded_instances", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [
            { key: "gemma-4-e2b-it", loaded_instances: [{ id: "inst-1" }] },
            { key: "gemma-4-e4b-it", loaded_instances: [] },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    const r = await lmStudioIsModelLoaded("http://localhost:1234", "gemma-4-e2b-it", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.loaded).toBe(true);
  });

  it("matches base key when listing includes ':2' model key", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [{ key: "gemma-4-e2b-it:2", loaded_instances: [{ id: "inst-2" }] }],
        });
      }
      return jsonResponse({}, 404);
    });
    const r = await lmStudioIsModelLoaded("http://localhost:1234", "gemma-4-e2b-it", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.loaded).toBe(true);
  });

  it("falls back to /api/v0/models when v1 is missing", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return jsonResponse({}, 404);
      if (url.endsWith("/api/v0/models")) {
        return jsonResponse({ models: [{ key: "gemma-4-e2b-it", loaded_instances: [] }] });
      }
      return jsonResponse({}, 404);
    });
    const r = await lmStudioIsModelLoaded("http://localhost:1234", "gemma-4-e2b-it", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.loaded).toBe(false);
  });
});
