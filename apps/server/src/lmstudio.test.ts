import { describe, expect, it, vi } from "vitest";
import { lmStudioIsModelLoaded, lmStudioUnload } from "./lmstudio.js";

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

describe("lmStudioUnload", () => {
  it("sends instance_id from loaded_instances[].id per LM Studio REST docs", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({
          models: [{ key: "my-model", loaded_instances: [{ id: "instance-abc" }] }],
        });
      }
      if (url.endsWith("/api/v1/models/unload")) {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        return jsonResponse({ instance_id: "instance-abc" });
      }
      return jsonResponse({}, 404);
    });
    const r = await lmStudioUnload("http://localhost:1234", "my-model", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(bodies).toEqual([{ instance_id: "instance-abc" }]);
  });

  it("when no listed instances, tries instance_id=modelKey then legacy model body on 400", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({
          models: [{ key: "openai/gpt-oss-20b", loaded_instances: [] }],
        });
      }
      if (url.endsWith("/api/v1/models/unload")) {
        const b = init?.body ? JSON.parse(String(init.body)) : null;
        bodies.push(b);
        if (b && "instance_id" in b && b.instance_id === "openai/gpt-oss-20b") {
          return jsonResponse({ error: "bad" }, 400);
        }
        if (b && "model" in b) {
          return jsonResponse({ ok: true });
        }
        return jsonResponse({}, 400);
      }
      return jsonResponse({}, 404);
    });
    const r = await lmStudioUnload("http://localhost:1234", "openai/gpt-oss-20b", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(bodies).toEqual([{ instance_id: "openai/gpt-oss-20b" }, { model: "openai/gpt-oss-20b" }]);
  });

  it("unloads each listed instance when multiple are loaded", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({
          models: [
            {
              key: "dup",
              loaded_instances: [{ id: "i1" }, { id: "i2" }],
            },
          ],
        });
      }
      if (url.endsWith("/api/v1/models/unload")) {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        return jsonResponse({});
      }
      return jsonResponse({}, 404);
    });
    const r = await lmStudioUnload("http://localhost:1234", "dup", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(bodies).toEqual([{ instance_id: "i1" }, { instance_id: "i2" }]);
  });
});
