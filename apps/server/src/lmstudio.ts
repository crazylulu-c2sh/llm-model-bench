import type { LoadTtlStatus } from "@llm-bench/shared";
import { verifyLmStudioTtlApplied } from "./lms-ttl-verify.js";
import type { FetchLike } from "./detect.js";
import { baseUrlCacheKey, isErrorEnvelope, stripDocumentedApiBaseSuffix } from "./http-shared.js";
import { providerFetch } from "./provider-fetch.js";

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
  /**
   * 실측(`GET /api/v1/models`): 실제로 잡힌 값은 이 최상위가 아니라 `config.context_length`에
   * 있다(예: `{"config":{"context_length":8192,"parallel":4,...}}`). 이 최상위 필드는 실제
   * 응답에서 관측되지 않아 죽은 정의였다 — 지우지 않고 `config`를 정확히 추가한다.
   */
  context_length?: number;
  config?: {
    context_length?: number;
    /** 병렬 슬롯 수. 총 KV 캐시 = parallel × context_length × bytes/token — 진단용으로만 읽는다. */
    parallel?: number;
  };
  /** JIT prime으로 건 TTL이 남은 시간(초). `lms ps`가 아니라 HTTP로 TTL을 확인할 수 있는 유일한 경로. */
  remaining_ttl_seconds?: number;
};
type LmStudioListedModel = {
  key?: string;
  /** 디스크/가중치 용량(바이트). 메모리-핏 프리플라이트(#81)의 required 예측 입력. */
  size_bytes?: number;
  loaded_instances?: LmStudioLoadedInstance[];
};

export type LmStudioRestProbeResult = {
  candidate: "native_chat";
  model: string;
  requested_context_length: number;
  requested_ttl_seconds: number;
  http_status: number;
  request_accepted: boolean;
  observed_context_length?: number;
  observed_ttl_seconds?: number;
  context_verified: boolean;
  ttl_verified: boolean;
  verification: "verified" | "unverified" | "rejected";
  body: string;
};

/**
 * 네이티브 REST 오리진 루트. 문서화된 baseUrl 기본형은 `http://host:1234/v1`(OpenAI 호환)이라
 * 접미사를 벗기지 않으면 `/v1/api/v1/models`를 때리게 되고, LM Studio는 그런 경로에
 * 404가 아니라 200 + `{"error": ...}`를 준다 — 실패가 조용한 성공으로 둔갑한다.
 */
function apiRoot(baseUrl: string): string {
  return stripDocumentedApiBaseSuffix(baseUrl.replace(/\/+$/, ""));
}

/** 본문이 JSON이면 파싱, 아니면 undefined — error 봉투 판별용. */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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
  const fetchImpl = opts.fetchImpl ?? providerFetch;
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      return { ok: false, status: r.status, models: [], body: "invalid model list response" };
    }
    // v1은 `{models:[…]}`, v0는 `{object,data:[…]}` — 형태가 다르다.
    const j = parsed as { models?: unknown[]; data?: unknown[] };
    const list = Array.isArray(j.models) ? j.models : Array.isArray(j.data) ? j.data : null;
    if (list === null) {
      // 200이지만 목록이 없다 = 이 엔드포인트가 아니다. 다음 후보로 넘어간다.
      if (isErrorEnvelope(parsed)) continue;
      return { ok: false, status: r.status, models: [], body: t.slice(0, 2000) };
    }
    return { ok: true, status: r.status, models: list as LmStudioListedModel[], body: t.slice(0, 2000) };
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
 * 저장된 모델별 설정이 없는 모델을 안전하게 로드하기 위한 `context_length` 상한.
 * (배경) 저장 설정이 없으면 LM Studio가 내장 기본값으로 뜬다 — 관측된 사례는 4×262144.
 * 명시적 load에 이 값을 실으면 실제로 그대로 잡힌다(실측 확인, `lmStudioLoad` 주석 참고).
 *
 * 262,144(무설정 관측 최댓값)의 1/4 — 대부분의 벤치 시나리오를 커버하면서 위험한 상한과는
 * 확실히 거리를 둔다. 이보다 큰 컨텍스트가 필요한 시나리오가 실측되면 조정 대상이다.
 */
export const SAFE_LOAD_CONTEXT_LENGTH_CAP = 65_536;
/** 일반적인 chat 시나리오가 여유롭게 도는 최소 하한 — 이보다 낮추지 않는다. */
export const SAFE_LOAD_CONTEXT_LENGTH_FLOOR = 8_192;
/** 실효 max_tokens(출력 상한)에 곱해 프롬프트 여유분을 확보하는 배수. */
const CONTEXT_LENGTH_HEADROOM_MULTIPLIER = 4;

/**
 * 로드 시 요청할 안전한 `context_length`를 계산한다 — 이 런의 실효 max_tokens에 여유 배수를 곱한
 * 값을, [FLOOR, CAP] 범위로 자르고, 모델 자체가 지원하는 상한(`modelMaxContextLength`, 있으면)을
 * 넘지 않게 한다. 순수 함수 — 어떤 IO도 하지 않는다.
 */
export function computeSafeLoadContextLength(
  effectiveMaxTokens: number,
  modelMaxContextLength?: number | null,
): number {
  const desired = Math.max(
    SAFE_LOAD_CONTEXT_LENGTH_FLOOR,
    Math.min(
      SAFE_LOAD_CONTEXT_LENGTH_CAP,
      Number.isFinite(effectiveMaxTokens) && effectiveMaxTokens > 0
        ? Math.ceil(effectiveMaxTokens * CONTEXT_LENGTH_HEADROOM_MULTIPLIER)
        : SAFE_LOAD_CONTEXT_LENGTH_FLOOR,
    ),
  );
  if (modelMaxContextLength != null && Number.isFinite(modelMaxContextLength) && modelMaxContextLength > 0) {
    return Math.min(desired, Math.floor(modelMaxContextLength));
  }
  return desired;
}

/**
 * LM Studio REST load — tries common paths; body uses model key from List API.
 * 명시적 load는 `ttl`을 **지원하지 않는다**(공식 문서: Idle TTL은 JIT 로딩에만 적용,
 * https://lmstudio.ai/docs/developer/core/ttl-and-auto-evict). `ttl`을 실으면 구버전이
 * 400/422로 거부해 로드 자체가 실패한다. TTL이 필요하면 {@link lmStudioJitTtlPrime}을 사용하라.
 *
 * `opts.contextLength`(공식 REST 최상위 필드 `context_length`, https://lmstudio.ai/docs/developer/rest/load) —
 * 저장된 모델별 설정이 없는 모델은 LM Studio 내장 기본값으로 뜬다. 실측(이 저장소 개발 중 컨텍스트
 * 기본값 인시던트 조사)으로 4096을 보내면 실제로 4096이 잡히는 것을 확인했다 — 안 보내면 이 안전장치가
 * 없다. 호출자(`prepareLmStudioForRun`)가 넘기지 않으면 이전과 동일하게 필드 자체를 생략한다.
 */
export async function lmStudioLoad(
  baseUrl: string,
  modelKey: string,
  opts: { fetchImpl?: FetchLike; apiKey?: string; contextLength?: number } = {},
): Promise<{ ok: boolean; status: number; body: string }> {
  const fetchImpl = opts.fetchImpl ?? providerFetch;
  const root = apiRoot(baseUrl);
  const candidates = [`${root}/api/v1/models/load`, `${root}/api/v0/models/load`];
  const body = JSON.stringify({
    model: modelKey,
    ...(opts.contextLength != null ? { context_length: opts.contextLength } : {}),
  });
  let last = { ok: false, status: 404, body: "no load endpoint" };
  for (const url of candidates) {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: headers(opts.apiKey),
      body,
    });
    const t = await r.text();
    if (r.status === 404) continue;
    // LM Studio는 모르는 경로에 200 + `{"error":…}`를 준다 — 성공으로 세면 로드하지 않고
    // 로드했다고 보고한다. 다음 후보를 시도하고, 다 떨어지면 실패로 돌린다.
    if (r.ok && isErrorEnvelope(safeJson(t))) {
      last = { ok: false, status: r.status, body: t.slice(0, 2000) };
      continue;
    }
    return { ok: r.ok, status: r.status, body: t.slice(0, 2000) };
  }
  return last;
}

/**
 * 문서화된 native chat 경로에 context와 TTL을 동시에 보내는 실측 후보.
 *
 * 이 함수는 일반 벤치 준비 경로에서 자동 호출하지 않는다. 네이티브 chat의
 * `ttl`은 문서에 보장된 필드가 아니므로, HTTP 성공을 지원 판정으로 사용하지
 * 않고 요청 직후 모델 목록의 실제 인스턴스 값을 확인하는 검증용 경로다.
 */
export async function probeLmStudioNativeChat(
  baseUrl: string,
  modelKey: string,
  opts: {
    contextLength: number;
    ttlSeconds: number;
    fetchImpl?: FetchLike;
    apiKey?: string;
    signal?: AbortSignal;
  },
): Promise<LmStudioRestProbeResult> {
  const fetchImpl = opts.fetchImpl ?? providerFetch;
  const root = apiRoot(baseUrl);
  const url = `${root}/api/v1/chat`;
  const r = await fetchImpl(url, {
    method: "POST",
    headers: headers(opts.apiKey),
    signal: opts.signal,
    body: JSON.stringify({
      model: modelKey,
      input: ".",
      context_length: opts.contextLength,
      ttl: opts.ttlSeconds,
      store: false,
      stream: false,
    }),
  });
  const body = (await r.text()).slice(0, 2000);
  if (!r.ok || isErrorEnvelope(safeJson(body))) {
    return {
      candidate: "native_chat",
      model: modelKey,
      requested_context_length: opts.contextLength,
      requested_ttl_seconds: opts.ttlSeconds,
      http_status: r.status,
      request_accepted: false,
      context_verified: false,
      ttl_verified: false,
      verification: "rejected",
      body,
    };
  }

  const listed = await lmStudioListModels(baseUrl, { fetchImpl, apiKey: opts.apiKey });
  const wanted = baseKey(modelKey);
  const instance = listed.models
    .filter((m) => typeof m.key === "string" && baseKey(m.key) === wanted)
    .flatMap((m) => (Array.isArray(m.loaded_instances) ? m.loaded_instances : []))[0];
  const observedContext = instance?.config?.context_length ?? instance?.context_length;
  const observedTtl = instance?.remaining_ttl_seconds;
  const contextVerified = observedContext === opts.contextLength;
  const ttlVerified = typeof observedTtl === "number" && observedTtl > 0;
  return {
    candidate: "native_chat",
    model: modelKey,
    requested_context_length: opts.contextLength,
    requested_ttl_seconds: opts.ttlSeconds,
    http_status: r.status,
    request_accepted: true,
    ...(observedContext !== undefined ? { observed_context_length: observedContext } : {}),
    ...(observedTtl !== undefined ? { observed_ttl_seconds: observedTtl } : {}),
    context_verified: contextVerified,
    ttl_verified: ttlVerified,
    verification: contextVerified && ttlVerified ? "verified" : "unverified",
    body,
  };
}

/**
 * base URL별 "JIT ttl 거부" 캐시 — Idle TTL 미지원 구버전 LM Studio가 chat 페이로드의 `ttl` 필드를
 * 400/422로 거절하는 경우, 같은 프로세스에서는 이후 prime부터 무-ttl로 바로 보낸다.
 * (openai-fetch.ts의 baseUrlsRejectingStreamOptions 패턴과 동일)
 */
const baseUrlsRejectingJitTtl = new Set<string>();

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
 * 구버전이 `ttl`을 400/422로 거절하면 무-ttl 재시도 후 base URL별 캐싱(`ttl_status: "rejected"`).
 *
 * 2xx는 적용을 **증명하지 않는다** — OpenAI 호환 서버는 모르는 body 필드를 거절이 아니라 조용히
 * 무시하는 게 일반적이라, 그런 빌드는 200을 주면서 `ttl`을 버린다. 그래서 성공 응답은
 * `"unknown"`으로 보고한다(거짓 성공 금지).
 */
export async function lmStudioJitTtlPrime(
  baseUrl: string,
  modelKey: string,
  opts: { fetchImpl?: FetchLike; apiKey?: string; ttlSeconds: number; signal?: AbortSignal },
): Promise<{ ok: boolean; status: number; body: string; ttl_status: LoadTtlStatus }> {
  const fetchImpl = opts.fetchImpl ?? providerFetch;
  const root = apiRoot(baseUrl);
  const url = `${root}/v1/chat/completions`;
  const key = baseUrlCacheKey(baseUrl);
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
    // ttl을 아예 싣지 않는다(이 base URL의 캐시된 거절, 또는 비양수/비유한 ttl).
    const r = await attempt(undefined);
    return { ...r, ttl_status: "not_applied" };
  }
  const r = await attempt(seconds);
  // 2xx는 "서버가 ttl을 읽었다"를 뜻하지 않는다 — 조용히 버렸을 수 있다.
  if (r.ok) return { ...r, ttl_status: "unknown" };
  if (looksLikeLmStudioTtlRejection(r.status, r.body)) {
    baseUrlsRejectingJitTtl.add(key);
    const retry = await attempt(undefined);
    return { ...retry, ttl_status: "rejected" };
  }
  return { ...r, ttl_status: "not_applied" };
}

/** `model_loaded` 이벤트의 `lm_studio_prepare` 라벨 — 이 런이 모델을 어떻게 준비했는지. */
export type LmStudioPrepareLabel =
  | "loaded"
  | "already_in_memory"
  | "load_skipped_by_request"
  | "jit_load_with_ttl";

export type LmStudioPrepareResult = {
  prepare: LmStudioPrepareLabel;
  /** TTL을 요청한 런에서만 채워진다. 미요청 런은 undefined(이벤트에서 필드 생략). */
  ttlStatus?: LoadTtlStatus;
  /** 이 런이 모델을 올렸는지 — 종료 시 auto-unload 판단용. */
  loadedByThisRun: boolean;
  /** 로드 자체가 실패. 호출자가 load_failed를 내고 중단한다. */
  error?: { status: number; body: string };
  /**
   * `contextLength`를 요청했는데 실제로 잡힌 컨텍스트가 그보다 크게 확인된 경우에만 채워진다.
   * JIT 경로(TTL 요청 시)는 `context_length`를 body에 실을 방법이 없어(실측 확인, chat completions
   * 요청의 임의 필드는 조용히 무시된다) 강제할 수 없다 — 대신 로드 후 사후 확인으로 감지한다.
   * 이미 상주 중이던 모델(다른 프로세스·이전 런이 올린 경우)도 같은 이유로 사후 확인한다.
   */
  contextLengthWarning?: { requestedContextLength: number; actualContextLength: number };
};

/**
 * `GET /api/v1/models`의 `loaded_instances[0].config.context_length`로 실제 잡힌 값을 읽는다.
 * (요청 필드가 조용히 무시될 수 있어 "줬다고 생각한 값"이 아니라 "실제로 잡힌 값"을 확인하는 것이
 * 유일하게 신뢰 가능한 방법이다.) 확인 불가(목록 조회 실패·미로드·필드 없음)면 `null` — 판단 보류.
 */
async function readActualLmStudioContextLength(
  baseUrl: string,
  modelId: string,
  opts: { fetchImpl?: FetchLike; apiKey?: string },
): Promise<number | null> {
  try {
    const listed = await lmStudioListModels(baseUrl, { ...opts, timeoutMs: 5000 });
    if (!listed.ok) return null;
    const wanted = baseKey(modelId);
    for (const m of listed.models) {
      if (!m || typeof m.key !== "string" || baseKey(m.key) !== wanted) continue;
      const inst = m.loaded_instances?.[0];
      const ctx = inst?.config?.context_length;
      return typeof ctx === "number" && Number.isFinite(ctx) && ctx > 0 ? ctx : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * `contextLength`(요청한 안전 상한)가 주어졌을 때만 실제 값을 확인해 경고 필드를 만든다.
 * 명시적 load 직후(신뢰 가능 — 실측 확인됨)에는 부르지 않는다; JIT·이미 상주 경로에서만 쓴다.
 */
async function checkContextLengthWarning(
  baseUrl: string,
  modelId: string,
  requestedContextLength: number | undefined,
  opts: { fetchImpl?: FetchLike; apiKey?: string },
): Promise<{ contextLengthWarning?: LmStudioPrepareResult["contextLengthWarning"] }> {
  if (requestedContextLength == null) return {};
  const actual = await readActualLmStudioContextLength(baseUrl, modelId, opts);
  if (actual == null || actual <= requestedContextLength) return {};
  return { contextLengthWarning: { requestedContextLength, actualContextLength: actual } };
}

/**
 * 런 시작 전 LM Studio 모델 준비 — 상주 확인 → (필요 시) 언로드 후 JIT prime 또는 명시적 load.
 *
 * bench/stress 두 러너가 같은 상태 기계를 각자 구현하고 있었고, 그래서 같은 입력에 서로 다른
 * 라벨을 보고하는 드리프트가 생겼다. 판단을 여기 한 곳에 둔다.
 *
 * `skipModelLoad`면 **아무 요청도 보내지 않는다**. prime은 실제 chat completion이라 JIT 로드를
 * 일으키는데, 그건 "LM 로드/언로드를 하지 말라"는 요청의 정반대다. 게다가 호출자의 메모리
 * 프리플라이트·상주 모델 회수가 모두 `!skipModelLoad` 게이트 안이라, 이 경로로 모델을 올리면
 * 적합성 검사 없이 올라간다.
 */
export async function prepareLmStudioForRun(opts: {
  baseUrl: string;
  modelId: string;
  skipModelLoad: boolean;
  /** 유한·양수일 때만 TTL 경로를 탄다. 호출자가 이미 정규화해서 넘긴다. */
  ttlSeconds?: number;
  fetchImpl?: FetchLike;
  apiKey?: string;
  signal?: AbortSignal;
  /**
   * 저장된 모델별 설정이 없을 때 내장 기본값(관측 사례: 4×262144)으로 뜨는 것을 막는 안전
   * 상한(`computeSafeLoadContextLength` 참고). 명시적 load에는 그대로 강제된다(실측 확인).
   * JIT/이미 상주 경로는 강제할 수 없어 사후 확인 후 `contextLengthWarning`으로만 알린다.
   */
  contextLength?: number;
}): Promise<LmStudioPrepareResult> {
  const { baseUrl, modelId, skipModelLoad, ttlSeconds, fetchImpl, apiKey, signal, contextLength } = opts;
  const wantsTtl = ttlSeconds != null;

  if (skipModelLoad) {
    return {
      prepare: "load_skipped_by_request",
      loadedByThisRun: false,
      ...(wantsTtl ? { ttlStatus: "not_applied" as const } : {}),
    };
  }

  const loaded = await lmStudioIsModelLoaded(baseUrl, modelId, { fetchImpl, apiKey });
  if (loaded.ok && loaded.loaded) {
    // Idle TTL은 JIT 로드 시점에만 설정할 수 있다. 이미 상주 중이면 이 런이 걸 방법이 없으므로
    // (모델을 내렸다 올리는 건 사용자가 요청하지 않은 상태 변경) 조용히 넘어가지 않는다.
    // 다만 **앞선 런이 걸어둔 TTL이 이미 살아 있을 수 있다** — 읽을 수 있으면 그걸 그대로 보고한다.
    // 그러지 않으면 TTL이 멀쩡히 걸린 모델에도 "미적용" 경고가 뜬다.
    const resident = wantsTtl ? await verifyLmStudioTtlApplied({ baseUrl, modelId }) : null;
    // 이미 상주 중인 모델은 우리가 로드 파라미터를 지정할 수 없었다(다른 프로세스·이전 런이
    // 올렸을 수 있다) — context_length가 위험하게 크지 않은지 사후로만 확인해 알린다.
    const warn = await checkContextLengthWarning(baseUrl, modelId, contextLength, { fetchImpl, apiKey });
    return {
      prepare: "already_in_memory",
      loadedByThisRun: false,
      ...(wantsTtl ? { ttlStatus: resident ?? ("not_applied" as const) } : {}),
      ...warn,
    };
  }

  // 여기까지 왔다는 건 "우리가 올릴 모델"이라는 뜻이다(직전 검사에서 미로드).
  // 시작 전에 이미 취소됐으면 아무것도 올리지 않는다.
  if (signal?.aborted) {
    return { prepare: "load_skipped_by_request", loadedByThisRun: false, ...(wantsTtl ? { ttlStatus: "not_applied" as const } : {}) };
  }

  await lmStudioUnload(baseUrl, modelId, { fetchImpl, apiKey });

  if (!wantsTtl) {
    // 명시적 load — context_length 를 그대로 실어 보낸다(실측 확인: 요청한 값이 정확히 잡힘).
    const load = await lmStudioLoad(baseUrl, modelId, { fetchImpl, apiKey, contextLength });
    if (!load.ok) return { prepare: "loaded", loadedByThisRun: false, error: load };
    return { prepare: "loaded", loadedByThisRun: true };
  }

  // Idle TTL은 명시적 load가 아닌 JIT 로딩(첫 추론 요청) 페이로드에만 적용된다.
  // 최소 prime(max_tokens=1 + 본문 ttl)으로 JIT 로드를 트리거한다 — ollama preload와 같은 패턴.
  const primed = await lmStudioJitTtlPrime(baseUrl, modelId, {
    fetchImpl,
    apiKey,
    ttlSeconds,
    signal,
  });
  if (primed.ok) {
    // 2xx는 적용을 증명하지 않는다 — 로컬 대상이면 `lms ps`로 실제 ttl을 읽어 확정한다.
    // 확인이 불가능하면(원격·CLI 미사용·형식 미상) 기존의 보수적인 값을 그대로 둔다.
    const verified = await verifyLmStudioTtlApplied({ baseUrl, modelId });
    // JIT prime(chat completions 요청)은 context_length 를 강제할 수단이 없다(실측 확인 — 보내도
    // 무시된다). TTL 기능을 유지하기 위해 이 경로는 그대로 두고, 대신 로드 후 실제 값을 확인해
    // 위험하면 경고만 표면화한다 — 인시던트 조사에서 나온 "실제로 잡힌 값을 확인하라"는 교훈.
    const warn = await checkContextLengthWarning(baseUrl, modelId, contextLength, { fetchImpl, apiKey });
    return {
      prepare: "jit_load_with_ttl",
      loadedByThisRun: true,
      ttlStatus: verified ?? primed.ttl_status,
      ...warn,
    };
  }

  // 정지 때문에 prime이 끊긴 경우엔 폴백하지 않는다. 여기서 명시적 load를 하면 "정지를 눌렀는데
  // 모델이, 그것도 TTL 없이 올라와 상주"하는 결과가 된다 — LM Studio 로그에는 우리가 끊은
  // "operation canceled"만 남아 원인도 안 보인다. prime이 이미 JIT 로드를 트리거했을 수 있으므로
  // 되돌린다(직전 검사에서 미로드였으니 이 모델은 우리 것이다).
  if (signal?.aborted) {
    await lmStudioUnload(baseUrl, modelId, { fetchImpl, apiKey });
    return { prepare: "load_skipped_by_request", loadedByThisRun: false, ttlStatus: "not_applied" };
  }

  // prime 실패(네트워크 등) — 명시적 load로 폴백해 로드 자체는 보장한다.
  // 명시적 load는 ttl 미지원이므로 TTL은 확실히 걸리지 않았고, 라벨도 JIT가 아니다.
  const load = await lmStudioLoad(baseUrl, modelId, { fetchImpl, apiKey, contextLength });
  if (!load.ok) {
    return { prepare: "loaded", loadedByThisRun: false, ttlStatus: "not_applied", error: load };
  }
  return { prepare: "loaded", loadedByThisRun: true, ttlStatus: "not_applied" };
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
  const fetchImpl = opts.fetchImpl ?? providerFetch;
  const root = apiRoot(baseUrl);
  const candidates = [`${root}/api/v1/models/unload`, `${root}/api/v0/models/unload`];

  const postUnload = async (payload: Record<string, unknown>) => {
    const body = JSON.stringify(payload);
    let last = { ok: false, status: 404, body: "no unload endpoint" };
    for (const url of candidates) {
      const r = await fetchImpl(url, {
        method: "POST",
        headers: headers(opts.apiKey),
        body,
      });
      const t = await r.text();
      if (r.status === 404) continue;
      if (r.ok && isErrorEnvelope(safeJson(t))) {
        last = { ok: false, status: r.status, body: t.slice(0, 2000) };
        continue;
      }
      return { ok: r.ok, status: r.status, body: t.slice(0, 2000) };
    }
    return last;
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
