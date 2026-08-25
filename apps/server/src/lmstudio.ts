import type { FetchLike } from "./detect.js";

function headers(apiKey?: string): HeadersInit {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

type LmStudioLoadedInstance = {
  id?: string;
  vram_usage?: number;
  vram?: number;
  vram_bytes?: number;
  ram_usage?: number;
  ram?: number;
  ram_bytes?: number;
  context_length?: number;
};
type LmStudioListedModel = {
  key?: string;
  /** 디스크/가중치 용량(바이트). 메모리-핏 프리플라이트(#81)의 required 예측 입력. */
  size_bytes?: number;
  loaded_instances?: LmStudioLoadedInstance[];
};

function apiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** 인스턴스 객체에서 keys를 순서대로 시도해 첫 유한·비음수 값(monitor-collect numberField와 동일 폴백). */
function firstNumberField(obj: unknown, keys: string[]): number | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  }
  return undefined;
}

/** #81: 모델 키에 해당하는 `size_bytes`(디스크/가중치). 없거나 0이면 undefined. */
export function lmStudioModelSizeBytes(
  models: readonly LmStudioListedModel[],
  modelKey: string,
): number | undefined {
  const wanted = baseKey(modelKey);
  for (const m of models) {
    if (!m || typeof m.key !== "string") continue;
    if (baseKey(m.key) !== wanted) continue;
    return typeof m.size_bytes === "number" && m.size_bytes > 0 ? m.size_bytes : undefined;
  }
  return undefined;
}

/** #81: `excludeKey` 이외에 현재 로드된 인스턴스들(메모리 회수 후보). RAM/VRAM 사용량 포함. */
export function lmStudioResidentInstances(
  models: readonly LmStudioListedModel[],
  excludeKey: string,
): Array<{ modelKey: string; instanceId: string; ramBytes?: number; vramBytes?: number }> {
  const exclude = baseKey(excludeKey);
  const out: Array<{ modelKey: string; instanceId: string; ramBytes?: number; vramBytes?: number }> = [];
  for (const m of models) {
    if (!m || typeof m.key !== "string") continue;
    if (baseKey(m.key) === exclude) continue;
    const instances = Array.isArray(m.loaded_instances) ? m.loaded_instances : [];
    for (const inst of instances) {
      const id = inst && typeof inst.id === "string" && inst.id.trim() ? inst.id.trim() : m.key;
      out.push({
        modelKey: m.key,
        instanceId: id,
        ramBytes: firstNumberField(inst, ["ram_usage", "ram", "ram_bytes"]),
        vramBytes: firstNumberField(inst, ["vram_usage", "vram", "vram_bytes"]),
      });
    }
  }
  return out;
}

/** LM Studio 모델 키 정규화: `:quant`/`:N` 접미를 제거해 bench modelId·CLI ps 키 매칭에 사용. */
export function baseKey(modelKey: string): string {
  return modelKey.replace(/:\d+$/, "");
}

/** `GET /api/v1/models` → `loaded_instances[].id` (공식 unload 본문의 instance_id). */
function instanceIdsForModelKey(models: LmStudioListedModel[], modelKey: string): string[] {
  const wanted = baseKey(modelKey);
  const ids: string[] = [];
  for (const m of models) {
    if (!m || typeof m.key !== "string") continue;
    if (baseKey(m.key) !== wanted) continue;
    const raw = m.loaded_instances;
    if (!Array.isArray(raw)) return ids;
    for (const item of raw) {
      if (item && typeof item === "object" && "id" in item) {
        const id = (item as { id: unknown }).id;
        if (typeof id === "string" && id.trim()) ids.push(id.trim());
      }
    }
    return ids;
  }
  return ids;
}

export async function lmStudioListModels(
  baseUrl: string,
  opts: { fetchImpl?: FetchLike; apiKey?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; models: LmStudioListedModel[]; body: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs;
  const root = apiRoot(baseUrl);
  const candidates = [`${root}/api/v1/models`, `${root}/api/v0/models`];
  // v1/v0 candidates는 단일 signal을 공유 — 두 endpoint가 직렬로 timeout을 누적해 hang하는 것을 방지.
  const signal = timeoutMs != null ? AbortSignal.timeout(timeoutMs) : undefined;
  for (const url of candidates) {
    const r = await fetchImpl(url, {
      headers: headers(opts.apiKey),
      ...(signal ? { signal } : {}),
    });
    const t = await r.text();
    if (r.status === 404) continue;
    if (!r.ok) return { ok: false, status: r.status, models: [], body: t.slice(0, 2000) };
    try {
      const j = JSON.parse(t) as { models?: unknown[] };
      return {
        ok: true,
        status: r.status,
        models: Array.isArray(j.models) ? (j.models as LmStudioListedModel[]) : [],
        body: t.slice(0, 2000),
      };
    } catch {
      return { ok: false, status: r.status, models: [], body: "invalid model list response" };
    }
  }
  return { ok: false, status: 404, models: [], body: "no list endpoint" };
}

export async function lmStudioIsModelLoaded(
  baseUrl: string,
  modelKey: string,
  opts: { fetchImpl?: FetchLike; apiKey?: string } = {},
): Promise<{ ok: boolean; status: number; loaded: boolean; body: string }> {
  const listed = await lmStudioListModels(baseUrl, opts);
  if (!listed.ok) return { ok: false, status: listed.status, loaded: false, body: listed.body };
  const wanted = baseKey(modelKey);
  for (const m of listed.models) {
    if (!m || typeof m.key !== "string") continue;
    if (baseKey(m.key) !== wanted) continue;
    const instances = Array.isArray(m.loaded_instances) ? m.loaded_instances : [];
    if (instances.length > 0) {
      return { ok: true, status: listed.status, loaded: true, body: listed.body };
    }
  }
  return { ok: true, status: listed.status, loaded: false, body: listed.body };
}

/**
 * LM Studio REST load — tries common paths; body uses model key from List API.
 * 명시적 load는 `ttl`을 **지원하지 않는다**(공식 문서: Idle TTL은 JIT 로딩에만 적용,
 * https://lmstudio.ai/docs/developer/core/ttl-and-auto-evict). `ttl`을 실으면 구버전이
 * 400/422로 거부해 로드 자체가 실패한다. TTL이 필요하면 {@link lmStudioJitTtlPrime}을 사용하라.
 */
export async function lmStudioLoad(
  baseUrl: string,
  modelKey: string,
  opts: { fetchImpl?: FetchLike; apiKey?: string } = {},
): Promise<{ ok: boolean; status: number; body: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const root = apiRoot(baseUrl);
  const candidates = [`${root}/api/v1/models/load`, `${root}/api/v0/models/load`];
  const body = JSON.stringify({ model: modelKey });
  for (const url of candidates) {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: headers(opts.apiKey),
      body,
    });
    const t = await r.text();
    if (r.status !== 404) return { ok: r.ok, status: r.status, body: t.slice(0, 2000) };
  }
  return { ok: false, status: 404, body: "no load endpoint" };
}

/**
 * base URL별 "JIT ttl 거부" 캐시 — Idle TTL 미지원 구버전 LM Studio가 chat 페이로드의 `ttl` 필드를
 * 400/422로 거절하는 경우, 같은 프로세스에서는 이후 prime부터 무-ttl로 바로 보낸다.
 * (openai-fetch.ts의 baseUrlsRejectingStreamOptions 패턴과 동일)
 */
const baseUrlsRejectingJitTtl = new Set<string>();

function normalizeBaseUrlForTtl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").toLowerCase();
}

export function _resetLmStudioJitTtlCacheForTests(): void {
  baseUrlsRejectingJitTtl.clear();
}

/** 로드 대기 여유 — LM Studio의 콜드 JIT 로드는 대형 모델에서 수 분이 걸릴 수 있다. */
const LMS_JIT_PRIME_TIMEOUT_MS = 600_000;

/**
 * `ttl` 낱말과 필드 거절을 시사하는 낱말이 **서로 가까이** 있을 때만 true.
 *
 * 단순히 본문에 `ttl`이 있는지만 보면 오탐이 난다 — 앞단 프록시의 `"request throttled"`가
 * 경계 없는 `ttl`에 걸리고, 400 응답이 요청 JSON을 그대로 에코하면 `"ttl":300`이 걸린다.
 * 오탐 한 번이면 그 base URL은 프로세스 수명 내내 TTL 비활성이 되므로(재시작 전엔 복구 불가)
 * 놓치는 쪽(= 매번 재시도 비용)이 훨씬 싸다.
 *
 * openai-fetch의 `stream_options` 패턴이 안전했던 건 그쪽이 고유 토큰을 봤기 때문이고,
 * `ttl`은 그렇지 않아 근접 조건을 추가로 요구한다.
 */
const TTL_REJECTION_WORD = "(?:unknown|unrecognized|unexpected|invalid|unsupported|not\\s+(?:allowed|permitted|supported))";
const TTL_REJECTION_RE = new RegExp(
  `\\bttl\\b[^.\\n]{0,40}?\\b${TTL_REJECTION_WORD}\\b|\\b${TTL_REJECTION_WORD}\\b[^.\\n]{0,40}?\\bttl\\b`,
  "i",
);

/** 400/422 본문이 `ttl` 필드 거절을 시사하면 true (휴리스틱). */
export function looksLikeLmStudioTtlRejection(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  return TTL_REJECTION_RE.test(body);
}

/**
 * LM Studio Idle TTL — JIT 로딩 트리거용 최소 prime 요청.
 *
 * 공식 문서(https://lmstudio.ai/docs/developer/core/ttl-and-auto-evict): `ttl`(초)은 명시적 load가 아닌
 * **JIT 로딩**(모델 미로드 상태에서 도착한 첫 추론 요청) 페이로드로만 적용된다. 따라서 모델이 로드되지
 * 않은 상태라면 이 최소 chat completion(`max_tokens: 1`, 본문 `ttl`)으로 JIT 로드를 트리거한다 —
 * ollama keep_alive preload와 동일한 패턴(응답은 폐기). 매 추론 요청마다 idle 타이머가 리셋되고,
 * TTL 만료 시 LM Studio가 모델을 자동 언로드한다.
 *
 * 구버전이 `ttl`을 400/422로 거절하면 무-ttl 재시도 후 base URL별 캐싱(`ttl_applied: false`).
 */
export async function lmStudioJitTtlPrime(
  baseUrl: string,
  modelKey: string,
  opts: { fetchImpl?: FetchLike; apiKey?: string; ttlSeconds: number; signal?: AbortSignal },
): Promise<{ ok: boolean; status: number; body: string; ttl_applied: boolean }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const root = apiRoot(baseUrl);
  const url = `${root}/v1/chat/completions`;
  const key = normalizeBaseUrlForTtl(baseUrl);
  const seconds = Math.floor(opts.ttlSeconds);
  const withTtl =
    !baseUrlsRejectingJitTtl.has(key) && Number.isFinite(seconds) && seconds > 0;

  const attempt = async (
    ttl: number | undefined,
  ): Promise<{ ok: boolean; status: number; body: string }> => {
    const body = JSON.stringify({
      model: modelKey,
      messages: [{ role: "user", content: "." }],
      max_tokens: 1,
      stream: false,
      ...(ttl != null ? { ttl } : {}),
    });
    // 러너의 취소 신호 + 자체 타임아웃. 둘 중 먼저 발화하는 쪽이 요청을 끊는다.
    // (재시도는 각자 새 예산을 받는다.)
    const timeout = AbortSignal.timeout(LMS_JIT_PRIME_TIMEOUT_MS);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    try {
      const r = await fetchImpl(url, {
        method: "POST",
        headers: headers(opts.apiKey),
        body,
        signal,
      });
      const t = await r.text();
      return { ok: r.ok, status: r.status, body: t.slice(0, 2000) };
    } catch (e) {
      // ollamaKeepAliveLoad와 동일한 never-throws 계약. 던지면 호출자의 "prime 실패 → 명시적
      // load 폴백" 경로가 도달 불가가 되고, 예외가 async generator 밖으로 빠져나가면서
      // unregisterRunControl이 실행되지 않아 run-control 레지스트리가 샌다.
      return { ok: false, status: 0, body: String(e).slice(0, 500) };
    }
  };

  if (!withTtl) {
    const r = await attempt(undefined);
    return { ...r, ttl_applied: false };
  }
  const r = await attempt(seconds);
  if (r.ok) return { ...r, ttl_applied: true };
  if (looksLikeLmStudioTtlRejection(r.status, r.body)) {
    baseUrlsRejectingJitTtl.add(key);
    const retry = await attempt(undefined);
    return { ...retry, ttl_applied: false };
  }
  return { ...r, ttl_applied: false };
}

/**
 * LM Studio 공식: `POST .../models/unload` + JSON `{ "instance_id": "<로드 인스턴스 id>" }`.
 * 목록의 `loaded_instances[].id`를 우선 사용합니다. 인스턴스가 없으면 `instance_id`에 모델 키를 넣어
 * 시도한 뒤(로드 응답과 동일한 식별자인 경우), 구버전 `{ model }` 본문으로 한 번 더 시도합니다.
 */
export async function lmStudioUnload(
  baseUrl: string,
  modelKey: string,
  opts: { fetchImpl?: FetchLike; apiKey?: string } = {},
): Promise<{ ok: boolean; status: number; body: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const root = apiRoot(baseUrl);
  const candidates = [`${root}/api/v1/models/unload`, `${root}/api/v0/models/unload`];

  const postUnload = async (payload: Record<string, unknown>) => {
    const body = JSON.stringify(payload);
    for (const url of candidates) {
      const r = await fetchImpl(url, {
        method: "POST",
        headers: headers(opts.apiKey),
        body,
      });
      const t = await r.text();
      if (r.status !== 404) return { ok: r.ok, status: r.status, body: t.slice(0, 2000) };
    }
    return { ok: false, status: 404, body: "no unload endpoint" };
  };

  const listed = await lmStudioListModels(baseUrl, opts);
  const fromList = listed.ok ? instanceIdsForModelKey(listed.models, modelKey) : [];

  if (fromList.length > 0) {
    let last = { ok: true, status: 200, body: "" };
    for (const instance_id of fromList) {
      last = await postUnload({ instance_id });
      if (!last.ok) return last;
    }
    return last;
  }

  let r = await postUnload({ instance_id: modelKey });
  if (!r.ok && (r.status === 400 || r.status === 422)) {
    r = await postUnload({ model: modelKey });
  }
  return r;
}
