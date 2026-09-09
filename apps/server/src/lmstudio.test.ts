import { beforeEach, describe, expect, it, vi } from "vitest";
import { _setExecFileForTest } from "./lms-cli.js";
import { _setLocalAddressesForTest } from "./util/localhost.js";
import {
  _resetLmStudioJitTtlCacheForTests,
  computeSafeLoadContextLength,
  lmStudioIsModelLoaded,
  prepareLmStudioForRun,
  lmStudioJitTtlPrime,
  lmStudioLoad,
  lmStudioUnload,
  looksLikeLmStudioTtlRejection,
  SAFE_LOAD_CONTEXT_LENGTH_CAP,
  SAFE_LOAD_CONTEXT_LENGTH_FLOOR,
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
        // 실제 v0 응답은 OpenAI 형태다 — `{models}`가 아니라 `{object, data}`.
        return jsonResponse({ object: "list", data: [{ key: "gemma-4-e2b-it", loaded_instances: [] }] });
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

  it("#194 후속(컨텍스트 기본값 인시던트 조사): contextLength 를 주면 body 에 context_length 로 실린다", async () => {
    // 실측 확인(LM Studio 실기): 이 필드를 보내면 요청한 값이 정확히 그대로 잡힌다.
    let sent: unknown = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models/load")) {
        sent = init?.body ? JSON.parse(String(init.body)) : null;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({}, 404);
    });
    const r = await lmStudioLoad("http://localhost:1234", "my-model", {
      fetchImpl,
      contextLength: 65_536,
    });
    expect(r.ok).toBe(true);
    expect(sent).toEqual({ model: "my-model", context_length: 65_536 });
  });

  it("contextLength 를 안 주면 이전과 동일하게 필드 자체가 생략된다(회귀 없음)", async () => {
    let sent: unknown = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models/load")) {
        sent = init?.body ? JSON.parse(String(init.body)) : null;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({}, 404);
    });
    await lmStudioLoad("http://localhost:1234", "my-model", { fetchImpl });
    expect(sent).toEqual({ model: "my-model" });
    expect(Object.prototype.hasOwnProperty.call(sent, "context_length")).toBe(false);
  });
});

describe("computeSafeLoadContextLength (#194 후속)", () => {
  it("작은 max_tokens 는 FLOOR(8192)까지 끌어올린다", () => {
    expect(computeSafeLoadContextLength(100)).toBe(SAFE_LOAD_CONTEXT_LENGTH_FLOOR);
  });

  it("큰 max_tokens(예: 모델카드의 262144)는 CAP(65536)에서 잘린다 — 이게 인시던트의 관측값이다", () => {
    expect(computeSafeLoadContextLength(262_144)).toBe(SAFE_LOAD_CONTEXT_LENGTH_CAP);
  });

  it("중간 값은 HEADROOM_MULTIPLIER(4배)로 프롬프트 여유를 확보한다", () => {
    expect(computeSafeLoadContextLength(4_096)).toBe(16_384);
  });

  it("모델 자체의 max_context_length 가 계산값보다 작으면 그쪽으로 더 좁힌다", () => {
    expect(computeSafeLoadContextLength(262_144, 4_096)).toBe(4_096);
  });

  it("모델의 max_context_length 가 계산값보다 크면 계산값(CAP 등)을 그대로 쓴다", () => {
    expect(computeSafeLoadContextLength(262_144, 131_072)).toBe(SAFE_LOAD_CONTEXT_LENGTH_CAP);
  });

  it("유효하지 않은 max_tokens(0·음수·NaN)는 FLOOR로 처리한다", () => {
    expect(computeSafeLoadContextLength(0)).toBe(SAFE_LOAD_CONTEXT_LENGTH_FLOOR);
    expect(computeSafeLoadContextLength(-5)).toBe(SAFE_LOAD_CONTEXT_LENGTH_FLOOR);
    expect(computeSafeLoadContextLength(Number.NaN)).toBe(SAFE_LOAD_CONTEXT_LENGTH_FLOOR);
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

  it("이미 상주 중인데 앞선 런의 TTL이 살아 있으면 그걸 보고한다", async () => {
    // TTL이 멀쩡히 걸린 모델에 "미적용" 경고를 띄우면 사용자는 매번 헛짚는다.
    process.env.ENABLE_LMS_CLI = "1";
    _setLocalAddressesForTest(["127.0.0.1"]);
    _setExecFileForTest(((_f: unknown, _a: unknown, _o: unknown, cb: unknown) => {
      (cb as (e: unknown, out: string, err: string) => void)?.(
        null,
        JSON.stringify([{ identifier: "m1", ttlMs: 3_600_000 }]),
        "",
      );
      return {} as never;
    }) as never);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models") || url.endsWith("/api/v0/models")) {
        return jsonResponse({ models: [{ key: "m1", loaded_instances: [{}] }] });
      }
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const r = await prepareLmStudioForRun({
      baseUrl: "http://127.0.0.1:1234",
      modelId: "m1",
      skipModelLoad: false,
      ttlSeconds: 3600,
      fetchImpl,
    });
    expect(r.prepare).toBe("already_in_memory");
    expect(r.ttlStatus).toBe("applied");
    delete process.env.ENABLE_LMS_CLI;
    _setLocalAddressesForTest(null);
    _setExecFileForTest(null);
  });

  it("이미 상주 중이고 TTL도 확인 안 되면 미적용으로 보고한다", async () => {
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

  it("#194 후속: 명시적 load(TTL 미사용)는 contextLength 를 그대로 body 에 실어 보낸다", async () => {
    let loadSent: unknown = null;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({ models: [{ key: "m1", loaded_instances: [] }] });
      }
      if (url.endsWith("/api/v1/models/load")) {
        loadSent = init?.body ? JSON.parse(String(init.body)) : null;
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const r = await prepareLmStudioForRun({
      baseUrl: "http://x:1234",
      modelId: "m1",
      skipModelLoad: false,
      fetchImpl,
      contextLength: 32_768,
    });
    expect(r.prepare).toBe("loaded");
    expect(loadSent).toMatchObject({ model: "m1", context_length: 32_768 });
    expect(r.contextLengthWarning).toBeUndefined();
  });

  it("#194 후속: 이미 상주 중인 모델이 요청 상한보다 큰 컨텍스트로 떠 있으면 경고를 채운다", async () => {
    // 다른 프로세스·이전 런이 올린 모델은 우리가 로드 파라미터를 지정할 수 없었다 —
    // 사후 확인만 가능하다는 걸 검증한다.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [
            {
              key: "m1",
              loaded_instances: [{ id: "m1", config: { context_length: 262_144, parallel: 4 } }],
            },
          ],
        });
      }
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const r = await prepareLmStudioForRun({
      baseUrl: "http://x:1234",
      modelId: "m1",
      skipModelLoad: false,
      fetchImpl,
      contextLength: 65_536,
    });
    expect(r.prepare).toBe("already_in_memory");
    expect(r.contextLengthWarning).toEqual({
      requestedContextLength: 65_536,
      actualContextLength: 262_144,
    });
  });

  it("#194 후속: 이미 상주 중인 모델이 요청 상한 이하면 경고를 채우지 않는다", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        return jsonResponse({
          models: [
            { key: "m1", loaded_instances: [{ id: "m1", config: { context_length: 8_192 } }] },
          ],
        });
      }
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const r = await prepareLmStudioForRun({
      baseUrl: "http://x:1234",
      modelId: "m1",
      skipModelLoad: false,
      fetchImpl,
      contextLength: 65_536,
    });
    expect(r.contextLengthWarning).toBeUndefined();
  });

  it("#194 후속: JIT prime(TTL 경로)은 context_length 를 강제할 수 없어 로드 후 사후 확인으로 경고한다", async () => {
    let listCallCount = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) {
        listCallCount++;
        // 1번째 조회(prepare 진입 시): 미로드. 2번째 조회(prime 이후 사후 확인): 큰 컨텍스트로 로드됨.
        if (listCallCount === 1) {
          return jsonResponse({ models: [{ key: "m1", loaded_instances: [] }] });
        }
        return jsonResponse({
          models: [
            {
              key: "m1",
              loaded_instances: [{ id: "m1", config: { context_length: 262_144, parallel: 4 } }],
            },
          ],
        });
      }
      if (url.endsWith("/v1/chat/completions")) {
        return jsonResponse({ choices: [{ message: { content: "." } }] });
      }
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const r = await prepareLmStudioForRun({
      baseUrl: "http://x:1234",
      modelId: "m1",
      skipModelLoad: false,
      ttlSeconds: 3600,
      fetchImpl,
      contextLength: 65_536,
    });
    expect(r.prepare).toBe("jit_load_with_ttl");
    expect(r.contextLengthWarning).toEqual({
      requestedContextLength: 65_536,
      actualContextLength: 262_144,
    });
  });
});

describe("문서화된 baseUrl 접미사(`/v1`)와 LM Studio의 200-not-404", () => {
  // LM Studio는 모르는 경로에 404가 아니라 200 + {"error": …}를 준다(실측).
  // 그래서 `/v1`을 안 벗기면 실패가 조용한 성공으로 둔갑한다.
  const unknownEndpoint = (url: string) =>
    jsonResponse({ error: `Unexpected endpoint or method. (${url})` }, 200);

  it("baseUrl에 `/v1`이 붙어도 네이티브 REST 오리진으로 정규화한다", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      seen.push(url);
      if (url === "http://localhost:1234/api/v1/models") {
        return jsonResponse({ models: [{ key: "m", loaded_instances: [{ id: "m" }] }] });
      }
      return unknownEndpoint(url);
    });
    const r = await lmStudioIsModelLoaded("http://localhost:1234/v1", "m", { fetchImpl });
    expect(r.loaded).toBe(true);
    expect(seen).toContain("http://localhost:1234/api/v1/models");
    expect(seen.some((u) => u.includes("/v1/api/"))).toBe(false);
  });

  it("목록: 200이지만 error 봉투면 다음 후보로 넘어간다", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/v1/models")) return unknownEndpoint(url);
      if (url.endsWith("/api/v0/models")) {
        return jsonResponse({ object: "list", data: [{ key: "m", loaded_instances: [{ id: "m" }] }] });
      }
      return jsonResponse({}, 404);
    });
    const r = await lmStudioIsModelLoaded("http://localhost:1234", "m", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.loaded).toBe(true);
  });

  it("load: 200 + error 봉투를 성공으로 세지 않는다 (로드 안 하고 했다고 보고하면 안 된다)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => unknownEndpoint(requestUrl(input)));
    const r = await lmStudioLoad("http://localhost:1234", "m", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.body).toContain("Unexpected endpoint");
  });

  it("unload: 200 + error 봉투를 성공으로 세지 않는다", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => unknownEndpoint(requestUrl(input)));
    const r = await lmStudioUnload("http://localhost:1234", "m", { fetchImpl });
    expect(r.ok).toBe(false);
  });
});
