import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetLmStudioJitTtlCacheForTests,
  lmStudioIsModelLoaded,
  prepareLmStudioForRun,
  lmStudioJitTtlPrime,
  lmStudioLoad,
  lmStudioUnload,
  looksLikeLmStudioTtlRejection,
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
    // 2xx는 적용을 증명하지 않는다 — 조용히 무시하는 서버가 흔하다.
    expect(r.ttl_status).toBe("unknown");
    expect(sent).toEqual({
      model: "my-model",
      messages: [{ role: "user", content: "." }],
      max_tokens: 1,
      stream: false,
      ttl: 300,
    });
  });

  it("retries without ttl when the server rejects it (400 unknown field) and reports ttl_status=rejected", async () => {
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
    expect(r.ttl_status).toBe("rejected");
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
    expect(r.ttl_status).toBe("not_applied");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toHaveProperty("ttl", 60);
  });

  // 러너의 "prime 실패 → 명시적 load 폴백" 경로는 ok:false로 돌아와야만 도달한다.
  // 던지면 그 경로가 죽고, 예외가 async generator 밖으로 빠져나가며 unregisterRunControl도 건너뛴다.
  it("never throws on network failure — returns ok:false like ollamaKeepAliveLoad", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    });
    const r = await lmStudioJitTtlPrime("http://localhost:1234", "m", { fetchImpl, ttlSeconds: 60 });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
    expect(r.ttl_status).toBe("not_applied");
    expect(r.body).toContain("ECONNREFUSED");
  });

  it("passes an abort signal to fetch and surfaces aborts as ok:false", async () => {
    const ac = new AbortController();
    ac.abort();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return jsonResponse({ choices: [] });
    });
    const r = await lmStudioJitTtlPrime("http://localhost:1234", "m", {
      fetchImpl,
      ttlSeconds: 60,
      signal: ac.signal,
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
  });

  it("always attaches a signal even when the caller passes none (self timeout)", async () => {
    let seenSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenSignal = init?.signal;
      return jsonResponse({ choices: [] });
    });
    await lmStudioJitTtlPrime("http://localhost:1234", "m", { fetchImpl, ttlSeconds: 60 });
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it("does not poison the cache on a 400 that merely contains the letters 'ttl'", async () => {
    const bodies: unknown[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/v1/chat/completions")) {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        calls += 1;
        // 앞단 프록시의 스로틀링 — "throttled" 안에 ttl이 들어 있다.
        if (calls === 1) return jsonResponse({ error: "request throttled, retry later" }, 400);
        return jsonResponse({ choices: [] });
      }
      return jsonResponse({}, 404);
    });
    const r = await lmStudioJitTtlPrime("http://localhost:1234", "m", { fetchImpl, ttlSeconds: 60 });
    // ttl 거절이 아니므로 무-ttl 재시도도, 캐시 등록도 없어야 한다.
    expect(r.ok).toBe(false);
    expect(bodies).toHaveLength(1);

    // 같은 base URL의 다음 prime은 여전히 ttl을 실어 보내야 한다(영구 비활성화 금지).
    const r2 = await lmStudioJitTtlPrime("http://localhost:1234", "m", { fetchImpl, ttlSeconds: 60 });
    expect(r2.ttl_status).toBe("unknown");
    expect(bodies[1]).toHaveProperty("ttl", 60);
  });

  it("does not poison the cache when a 400 echoes the request body containing ttl", async () => {
    const bodies: unknown[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/v1/chat/completions")) {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        calls += 1;
        // ttl과 무관한 400인데 응답이 요청 JSON을 그대로 되비춘다.
        if (calls === 1) {
          return jsonResponse(
            { error: "unknown model 'm'", request: { model: "m", max_tokens: 1, ttl: 60 } },
            400,
          );
        }
        return jsonResponse({ choices: [] });
      }
      return jsonResponse({}, 404);
    });
    await lmStudioJitTtlPrime("http://localhost:1234", "m", { fetchImpl, ttlSeconds: 60 });
    expect(bodies).toHaveLength(1);
    const r2 = await lmStudioJitTtlPrime("http://localhost:1234", "m", { fetchImpl, ttlSeconds: 60 });
    expect(r2.ttl_status).toBe("unknown");
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
    expect(r1.ttl_status).toBe("not_applied");
    expect(r2.ttl_status).toBe("not_applied");
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

describe("looksLikeLmStudioTtlRejection", () => {
  it("accepts genuine ttl field rejections in common phrasings", () => {
    for (const body of [
      '{"error":"unknown field ttl, expected model"}',
      '{"error":{"message":"Unexpected field \'ttl\'"}}',
      '{"error":"ttl is not supported by this build"}',
      '{"error":"invalid parameter: ttl"}',
    ]) {
      expect(looksLikeLmStudioTtlRejection(400, body)).toBe(true);
    }
  });

  it("rejects bodies where 'ttl' appears without a nearby rejection word", () => {
    for (const body of [
      // "throttled" 안의 ttl — 경계 없는 매칭이면 여기서 오탐이 났다.
      '{"error":"request throttled, retry later"}',
      // 무관한 400이 요청 JSON을 에코 — ttl은 있지만 거절 대상이 아니다.
      '{"error":"unknown model \'m\'","request":{"model":"m","max_tokens":1,"ttl":60}}',
      '{"error":"context length exceeded"}',
    ]) {
      expect(looksLikeLmStudioTtlRejection(400, body)).toBe(false);
    }
  });

  it("only considers 400/422", () => {
    expect(looksLikeLmStudioTtlRejection(500, '{"error":"unknown field ttl"}')).toBe(false);
    expect(looksLikeLmStudioTtlRejection(422, '{"error":"unknown field ttl"}')).toBe(true);
  });
});

/**
 * 런 준비 경로. 여기가 비어 있어서 "정지를 눌렀는데 모델이 TTL 없이 상주"하는 경로를 오래 못 봤다 —
 * LM Studio 로그에는 우리가 끊은 "operation canceled"만 남아 원인이 보이지 않는다.
 */
describe("prepareLmStudioForRun", () => {
  beforeEach(() => _resetLmStudioJitTtlCacheForTests());

  /** 미로드 상태를 흉내 내고, 어떤 엔드포인트가 불렸는지 기록한다. */
  function stub(handlers: {
    onPrime?: (url: string) => Promise<Response>;
  } = {}) {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      calls.push(url);
      if (url.endsWith("/api/v1/models") || url.endsWith("/api/v0/models")) {
        return jsonResponse({ models: [{ key: "m1", loaded_instances: [] }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        if (handlers.onPrime) return handlers.onPrime(url);
        return jsonResponse({ choices: [{ message: { content: "." } }] });
      }
      return jsonResponse({ ok: true });
    });
    return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
  }

  const loadCalls = (calls: string[]) => calls.filter((u) => u.includes("/models/load"));
  const unloadCalls = (calls: string[]) => calls.filter((u) => u.includes("/models/unload"));

  it("시작 전에 이미 정지됐으면 아무것도 올리지 않는다", async () => {
    const { calls, fetchImpl } = stub();
    const ac = new AbortController();
    ac.abort();
    const r = await prepareLmStudioForRun({
      baseUrl: "http://x:1234",
      modelId: "m1",
      skipModelLoad: false,
      ttlSeconds: 3600,
      fetchImpl,
      signal: ac.signal,
    });
    expect(r.loadedByThisRun).toBe(false);
    expect(r.ttlStatus).toBe("not_applied");
    expect(loadCalls(calls)).toEqual([]);
    expect(calls.filter((u) => u.endsWith("/v1/chat/completions"))).toEqual([]);
  });

  it("prime이 정지로 끊기면 명시적 load로 폴백하지 않고 되돌린다", async () => {
    // 폴백하면 "정지했는데 모델이, 그것도 TTL 없이(명시적 load는 ttl 미지원) 상주"하게 된다.
    const ac = new AbortController();
    const { calls, fetchImpl } = stub({
      onPrime: async () => {
        ac.abort();
        throw new DOMException("The operation was aborted.", "AbortError");
      },
    });
    const r = await prepareLmStudioForRun({
      baseUrl: "http://x:1234",
      modelId: "m1",
      skipModelLoad: false,
      ttlSeconds: 3600,
      fetchImpl,
      signal: ac.signal,
    });
    expect(r.loadedByThisRun).toBe(false);
    expect(r.ttlStatus).toBe("not_applied");
    expect(loadCalls(calls), "정지 후 명시적 load로 폴백했다").toEqual([]);
    // prime이 이미 JIT 로드를 트리거했을 수 있으므로 되돌린다(직전 검사에서 미로드였다).
    expect(unloadCalls(calls).length).toBeGreaterThan(0);
  });

  it("정지가 아닌 prime 실패는 기존대로 명시적 load로 폴백한다", async () => {
    const { calls, fetchImpl } = stub({
      onPrime: async () => {
        throw new TypeError("network down");
      },
    });
    const r = await prepareLmStudioForRun({
      baseUrl: "http://x:1234",
      modelId: "m1",
      skipModelLoad: false,
      ttlSeconds: 3600,
      fetchImpl,
    });
    expect(loadCalls(calls).length).toBeGreaterThan(0);
    expect(r.ttlStatus).toBe("not_applied");
  });

  it("이미 상주 중인 모델에는 TTL을 걸지 못한다고 보고한다", async () => {
    // LM Studio는 로드 시점에만 TTL을 받는다 — 조용히 넘어가면 사용자는 TTL이 걸린 줄 안다.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") || url.endsWith("/api/v0/models")) {
        return jsonResponse({ models: [{ key: "m1", loaded_instances: [{}] }] });
      }
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const r = await prepareLmStudioForRun({
      baseUrl: "http://x:1234",
      modelId: "m1",
      skipModelLoad: false,
      ttlSeconds: 3600,
      fetchImpl,
    });
    expect(r.prepare).toBe("already_in_memory");
    expect(r.ttlStatus).toBe("not_applied");
    expect(r.loadedByThisRun).toBe(false);
  });
});
