import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetLmStudioJitTtlCacheForTests,
  lmStudioIsModelLoaded,
  lmStudioJitTtlPrime,
  lmStudioLoad,
  lmStudioUnload,
} from "./lmstudio.js";

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

describe("lmStudioLoad", () => {
  it("sends only { model } in load body (ttl 옵션 없음)", async () => {
    let sent: unknown = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models/load")) {
        sent = init?.body ? JSON.parse(String(init.body)) : null;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({}, 404);
    });
    const r = await lmStudioLoad("http://localhost:1234", "my-model", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(sent).toEqual({ model: "my-model" });
  });

  it("never sends ttl in load body (명시적 load는 ttl 미지원 — 구버전이 400으로 거부)", async () => {
    let sent: unknown = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models/load")) {
        sent = init?.body ? JSON.parse(String(init.body)) : null;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({}, 404);
    });
    const r = await lmStudioLoad("http://localhost:1234", "my-model", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(sent).toEqual({ model: "my-model" });
  });
});

describe("lmStudioJitTtlPrime", () => {
  beforeEach(() => _resetLmStudioJitTtlCacheForTests());

  it("sends a minimal chat completion with ttl (seconds) to trigger JIT load", async () => {
    let sent: unknown = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/v1/chat/completions")) {
        sent = init?.body ? JSON.parse(String(init.body)) : null;
        return jsonResponse({ choices: [{ message: { content: "x" } }] });
      }
      return jsonResponse({}, 404);
    });
    const r = await lmStudioJitTtlPrime("http://localhost:1234", "my-model", {
      fetchImpl,
      ttlSeconds: 300,
    });
    expect(r.ok).toBe(true);
    expect(r.ttl_applied).toBe(true);
    expect(sent).toEqual({
      model: "my-model",
      messages: [{ role: "user", content: "." }],
      max_tokens: 1,
      stream: false,
      ttl: 300,
    });
  });

  it("retries without ttl when the server rejects it (400 unknown field) and reports ttl_applied=false", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/v1/chat/completions")) {
        const b = init?.body ? JSON.parse(String(init.body)) : null;
        bodies.push(b);
        if (b && "ttl" in b) return jsonResponse({ error: "unknown field ttl, expected model" }, 400);
        return jsonResponse({ choices: [] });
      }
      return jsonResponse({}, 404);
    });
    const r = await lmStudioJitTtlPrime("http://localhost:1234", "my-model", {
      fetchImpl,
      ttlSeconds: 300,
    });
    expect(r.ok).toBe(true);
    expect(r.ttl_applied).toBe(false);
    expect(bodies).toEqual([
      { model: "my-model", messages: [{ role: "user", content: "." }], max_tokens: 1, stream: false, ttl: 300 },
      { model: "my-model", messages: [{ role: "user", content: "." }], max_tokens: 1, stream: false },
    ]);
  });

  it("caches the rejection per base URL — subsequent primes send no ttl on first attempt", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/v1/chat/completions")) {
        const b = init?.body ? JSON.parse(String(init.body)) : null;
        bodies.push(b);
        if (b && "ttl" in b) return jsonResponse({ error: "unknown field ttl" }, 400);
        return jsonResponse({ choices: [] });
      }
      return jsonResponse({}, 404);
    });
    await lmStudioJitTtlPrime("http://localhost:1234", "m", { fetchImpl, ttlSeconds: 60 });
    // trailing slash — 정규화 후 동일한 base URL로 캐시 적중
    await lmStudioJitTtlPrime("http://localhost:1234/", "m", { fetchImpl, ttlSeconds: 60 });
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).not.toHaveProperty("ttl");
  });

  it("does not retry on non-ttl errors (e.g. 500)", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/v1/chat/completions")) {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        return jsonResponse({ error: "boom" }, 500);
      }
      return jsonResponse({}, 404);
    });
    const r = await lmStudioJitTtlPrime("http://localhost:1234", "m", { fetchImpl, ttlSeconds: 60 });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
    expect(r.ttl_applied).toBe(false);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toHaveProperty("ttl", 60);
  });

  it("sends no ttl when ttlSeconds is non-positive/invalid", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/v1/chat/completions")) {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        return jsonResponse({ choices: [] });
      }
      return jsonResponse({}, 404);
    });
    const r1 = await lmStudioJitTtlPrime("http://localhost:1234", "m", { fetchImpl, ttlSeconds: 0 });
    const r2 = await lmStudioJitTtlPrime("http://localhost:1234", "m", { fetchImpl, ttlSeconds: -5 });
    expect(r1.ttl_applied).toBe(false);
    expect(r2.ttl_applied).toBe(false);
    for (const b of bodies) {
      expect(b && !("ttl" in (b as object))).toBe(true);
    }
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
