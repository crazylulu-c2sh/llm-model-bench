import {
  isBenchExcludedModelArtifact,
  parseModelPublisherFromId,
  type DetectResult,
  type DetectStep,
  type InferenceEngine,
  type ProviderKind,
  type Reachability,
  type ReachabilityCode,
} from "@llm-bench/shared";
import { stripDocumentedApiBaseSuffix } from "./http-shared.js";
import { providerFetch } from "./provider-fetch.js";

export type FetchLike = typeof fetch;

/**
 * API `publisher` 우선, 없으면 id의 `org/` 접두. 둘 다 없으면 undefined.
 * detect 응답을 만들 때와 런 meta를 기록할 때가 같은 규칙을 써야 하므로 러너도 이걸 쓴다.
 */
export function resolvePublisher(modelId: string, apiPublisher?: string | null): string | undefined {
  if (typeof apiPublisher === "string" && apiPublisher.trim()) return apiPublisher.trim();
  return parseModelPublisherFromId(modelId);
}

const LIST_STEP_NAMES = ["lm_studio_list", "ollama_tags", "unsloth_models", "openai_models"] as const;

/**
 * 문서에 적힌 API 베이스를 서버 루트로 맞춤 — 이 앱은 `base + /v1/...`와 `base + /api/v1/...`을 직접 조합합니다.
 * OpenAI 호환 `…/v1`뿐 아니라 LM Studio가 안내하는 `…/api/v1`·`…/api/v0`도 그대로 두면 경로가 두 번 붙어
 * 죽은 주소를 찌르게 됩니다. LM Studio는 모르는 경로에도 200을 주므로 그 오진이 조용히 성공처럼 보입니다.
 */
export function normalizeBaseUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  // `startsWith("http")`는 `HTTP://…`를 스킴 없는 호스트로 봐서 `http://HTTP://…`라는 가짜 호스트를 만든다.
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  u = stripDocumentedApiBaseSuffix(u);
  return u.replace(/\/+$/, "");
}

function headers(apiKey?: string): HeadersInit {
  const h: Record<string, string> = {};
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

/**
 * 요청 1건의 상한. detect는 목록 3개 + 능력 프로브 2개를 순차로 던지므로 상한이 없으면
 * undici 기본 connect timeout(약 10.5초)이 요청 수만큼 누적돼 50초 넘게 매달린다.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

/** 원점에 아예 닿지 못했다는 뜻의 전송 계층 코드 — 같은 원점의 나머지 경로를 더 볼 이유가 없다. */
const ORIGIN_DEAD_CODES = new Set([
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/**
 * fetch 실패는 `TypeError: fetch failed`로만 올라오고 진짜 원인은 cause 체인에 묻힌다.
 * EHOSTUNREACH(로컬 네트워크 권한 거부)와 ECONNREFUSED(서버 꺼짐)를 구분하려면 코드가 필요하다.
 */
function fetchErrorCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 4; depth += 1) {
    const node = cur as { code?: unknown; name?: unknown; cause?: unknown };
    if (node.name === "TimeoutError") return "ETIMEDOUT";
    if (typeof node.code === "string") return node.code;
    cur = node.cause;
  }
  return undefined;
}

/** step.detail·reachability.reason에 남길 문자열 — 원인 코드까지 보존한다. */
export function describeFetchError(e: unknown): string {
  const code = fetchErrorCode(e);
  const base = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return code && !base.includes(code) ? `${base} (${code})` : base;
}

/** 원점이 죽은 게 확실할 때의 즉시 반환 — 남은 목록 경로와 능력 프로브를 건너뛴다. */
function originDeadResult(baseUrl: string, steps: DetectStep[], code: string | undefined): DetectResult {
  return {
    provider: "manual",
    baseUrl,
    models: [],
    steps,
    capabilities: { openaiChat: false, anthropicMessages: false },
    reachability: computeReachability(steps, code),
  };
}

/** LM Studio `/api/v1/models` 항목. 이 형태가 나와야 LM Studio로 단정할 수 있다. */
type LmStudioNativeModel = {
  key?: string;
  type?: string;
  display_name?: string;
  publisher?: string | null;
  size_bytes?: number;
  params_string?: string | null;
};

/** `/api/v0/models`(OpenAI 호환 확장) 응답 항목 — 네이티브 `/api/v1/models`에는 없는 실행엔진 필드. */
type LmStudioV0Model = {
  id?: string;
  compatibility_type?: string;
  quantization?: string;
  arch?: string;
  /** 이 모델이 지원하는 최대 컨텍스트(토큰). 로드 시 안전한 context_length 상한 계산에 쓴다(#194 후속). */
  max_context_length?: number;
};

type LmStudioCompatExtras = {
  compatibility_type?: string;
  quantization?: string;
  arch?: string;
  max_context_length?: number;
};

/**
 * #182: best-effort 보강 — `/api/v0/models`는 `compatibility_type`/`quantization`/`arch`/
 * `max_context_length`를 주지만 네이티브 `/api/v1/models`에는 없다. 이 조회가 실패해도(구버전
 * LM Studio, 타임아웃 등) v1 detect 결과 자체는 절대 훼손하지 않는다 — 실패 시 빈 맵을 반환한다.
 */
async function fetchLmStudioCompatExtras(
  fetchImpl: FetchLike,
  baseUrl: string,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<Map<string, LmStudioCompatExtras>> {
  const out = new Map<string, LmStudioCompatExtras>();
  try {
    const r = await fetchImpl(`${baseUrl}/api/v0/models`, {
      headers: headers(apiKey),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return out;
    const body = (await r.json()) as { data?: LmStudioV0Model[] };
    for (const m of body.data ?? []) {
      if (typeof m.id !== "string" || !m.id) continue;
      out.set(m.id, {
        compatibility_type: typeof m.compatibility_type === "string" ? m.compatibility_type : undefined,
        quantization: typeof m.quantization === "string" ? m.quantization : undefined,
        arch: typeof m.arch === "string" ? m.arch : undefined,
        max_context_length:
          typeof m.max_context_length === "number" && m.max_context_length > 0
            ? m.max_context_length
            : undefined,
      });
    }
  } catch {
    // best-effort — v1 성공 결과를 이걸로 망치지 않는다.
  }
  return out;
}

/** 이미 쌓은 step에 사유만 덧붙인다 — 새 step을 push하면 도달성 계산이 어긋난다. */
function annotateLastStep(steps: DetectStep[], detail: string): void {
  const i = steps.length - 1;
  if (i >= 0) steps[i] = { ...steps[i], detail };
}

function isOriginDead(e: unknown): boolean {
  const code = fetchErrorCode(e);
  return code !== undefined && ORIGIN_DEAD_CODES.has(code);
}

/** 전송 계층 코드 → UI가 번역할 분류. 알 수 없는 코드는 일반 네트워크 실패로 둔다. */
function classifyTransportCode(code: string | undefined): ReachabilityCode {
  switch (code) {
    case "UND_ERR_CONNECT_TIMEOUT":
    case "ETIMEDOUT":
      return "connect_timeout";
    case "ECONNREFUSED":
      return "refused";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "dns";
    case "EPROTO":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
      return "tls";
    default:
      return "network";
  }
}

function computeReachability(steps: DetectStep[], transportCode?: string): Reachability {
  const list = steps.filter((s) => (LIST_STEP_NAMES as readonly string[]).includes(s.name));
  if (list.length === 0) return { ok: true, state: "ok" };

  const withoutStatus = list.filter((s) => s.status === undefined);
  if (withoutStatus.length === list.length) {
    return {
      ok: false,
      state: "unreachable",
      code: classifyTransportCode(transportCode),
      reason: withoutStatus[0]?.detail,
    };
  }
  if (withoutStatus.length > 0) {
    return {
      ok: false,
      state: "partial",
      code: "partial",
      reason: withoutStatus[0]?.detail,
    };
  }
  return { ok: true, state: "ok" };
}

const reachOk: Reachability = { ok: true, state: "ok" };

/** `/api/v1/models`로 식별된 LM Studio는 OpenAI·Anthropic 호환 POST를 제공합니다. 가짜 모델명 프로브는 400이 나와 역능력 판별과 맞지 않으므로 고정합니다. */
const LM_STUDIO_COMPAT_CAPS = { openaiChat: true, anthropicMessages: true } as const;

/** `/api/tags`로 식별된 Ollama는 OpenAI 호환 `/v1/chat/completions`를 제공합니다. 가짜 모델명 프로브는 404+JSON이 나와 역능력 판별과 맞지 않으므로 고정합니다. */
const OLLAMA_COMPAT_CAPS = { openaiChat: true, anthropicMessages: false } as const;

/** Unsloth Studio는 OpenAI·Anthropic 호환을 같은 포트에 제공합니다. */
const UNSLOTH_STUDIO_COMPAT_CAPS = { openaiChat: true, anthropicMessages: true } as const;

/** Studio `/api/models/list` 항목 — audio/diffusion은 벤치 목록에서 제외. */
type UnslothListedModel = {
  id?: string;
  name?: string | null;
  is_audio?: boolean;
  is_diffusion?: boolean;
  is_vision?: boolean;
  is_gguf?: boolean;
  is_mlx?: boolean;
};

export async function detectProvider(
  rawBaseUrl: string,
  opts: {
    fetchImpl?: FetchLike;
    apiKey?: string;
    manual?: { provider: ProviderKind; models?: { id: string; label?: string }[] };
    timeoutMs?: number;
  } = {},
): Promise<DetectResult> {
  const fetchImpl = opts.fetchImpl ?? providerFetch;
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const steps: DetectStep[] = [];
  /** 첫 전송 실패의 코드 — 도달 실패 사유를 UI가 번역할 수 있게 분류의 근거로 쓴다. */
  let transportCode: string | undefined;

  if (opts.manual?.provider && opts.manual.provider !== "manual") {
    const models = opts.manual.models?.length
      ? opts.manual.models
      : [{ id: "manual-model", label: "manual-model" }];
    const caps =
      opts.manual.provider === "lm_studio"
        ? LM_STUDIO_COMPAT_CAPS
        : opts.manual.provider === "unsloth_studio"
          ? UNSLOTH_STUDIO_COMPAT_CAPS
          : await probeCapabilities(fetchImpl, baseUrl, opts.apiKey, timeoutMs);
    return {
      provider: opts.manual.provider,
      baseUrl,
      models,
      steps: [{ name: "manual", ok: true, detail: opts.manual.provider }],
      capabilities: caps,
      reachability: reachOk,
    };
  }

  // 1) LM Studio native list
  try {
    const r = await fetchImpl(`${baseUrl}/api/v1/models`, {
      headers: headers(opts.apiKey),
      signal: AbortSignal.timeout(timeoutMs),
    });
    steps.push({
      name: "lm_studio_list",
      ok: r.ok,
      status: r.status,
    });
    if (r.ok) {
      // 본문 파싱 실패는 전송 실패와 다르다 — 바깥 catch로 흘리면 status 없는 step이 하나 더 쌓여
      // computeReachability가 목록 경로 일부만 응답한 것("partial")으로 오판한다. 쌓아둔 step을 갱신만 한다.
      let body: { models?: unknown[] } | undefined;
      try {
        body = (await r.json()) as { models?: unknown[] };
      } catch {
        annotateLastStep(steps, "invalid_json");
      }

      // LM Studio는 모르는 경로에도 200 + `{"error":"Unexpected endpoint or method."}`를 돌려준다.
      // 200이라는 사실만으로 LM Studio라고 단정하면, 베이스 URL에 경로가 섞였을 때
      // "모델 0개인 정상 연결"이라는 가짜 성공이 만들어진다. 네이티브 `models` 배열이 있어야 한다.
      const modelsArr = Array.isArray(body?.models) ? body.models : undefined;
      if (modelsArr) {
        // #182: 실행엔진(gguf/mlx)·양자화·arch는 네이티브 v1에 없고 v0(OpenAI 호환 확장)에만 있다.
        // best-effort — 실패해도 빈 맵이라 아래 models 자체는 그대로 성공한다.
        const compatExtras = await fetchLmStudioCompatExtras(fetchImpl, baseUrl, opts.apiKey, timeoutMs);
        const models = modelsArr
          .map((m) => m as LmStudioNativeModel)
          .filter((m) => typeof m.key === "string" && m.key)
          .filter((m) => m.type === "llm" || !m.type)
          .filter(
            (m) =>
              !isBenchExcludedModelArtifact(
                m.key as string,
                m.display_name,
                compatExtras.get(m.key as string)?.arch,
              ),
          )
          .map((m) => ({
            id: m.key as string,
            label: m.display_name ?? (m.key as string),
            kind: m.type,
            publisher: resolvePublisher(m.key as string, m.publisher),
            size_bytes: typeof m.size_bytes === "number" && m.size_bytes > 0 ? m.size_bytes : undefined,
            params_string:
              typeof m.params_string === "string" && m.params_string.trim()
                ? m.params_string.trim()
                : undefined,
            ...compatExtras.get(m.key as string),
          }));
        if (models.length === 0) {
          annotateLastStep(steps, modelsArr.length === 0 ? "empty_model_list" : "no_benchable_model");
        }
        return {
          provider: "lm_studio",
          baseUrl,
          models,
          steps,
          capabilities: LM_STUDIO_COMPAT_CAPS,
          reachability: reachOk,
        };
      }
      if (body) annotateLastStep(steps, "unrecognized_model_shape");
      // LM Studio가 아니다 — Ollama·OpenAI 호환 경로로 계속 확인한다.
    }
  } catch (e) {
    steps.push({
      name: "lm_studio_list",
      ok: false,
      detail: describeFetchError(e),
    });
    transportCode ??= fetchErrorCode(e);
    if (isOriginDead(e)) return originDeadResult(baseUrl, steps, transportCode);
  }

  // 2) Ollama tags
  try {
    const r = await fetchImpl(`${baseUrl}/api/tags`, {
      headers: headers(opts.apiKey),
      signal: AbortSignal.timeout(timeoutMs),
    });
    steps.push({ name: "ollama_tags", ok: r.ok, status: r.status });
    if (r.ok) {
      const j = (await r.json()) as { models?: { name: string; model?: string }[] };
      if (Array.isArray(j.models)) {
        const models = j.models
          .map((m) => {
            const row = m as { name?: string; model?: string; size?: number };
            const id = row.name ?? row.model ?? "unknown";
            return {
              id,
              label: row.name ?? row.model,
              publisher: resolvePublisher(id),
              size_bytes: typeof row.size === "number" && row.size > 0 ? row.size : undefined,
            };
          })
          .filter((m) => !isBenchExcludedModelArtifact(m.id, m.label));
        return {
          provider: "ollama",
          baseUrl,
          models,
          steps,
          capabilities: OLLAMA_COMPAT_CAPS,
          reachability: reachOk,
        };
      }
    }
  } catch (e) {
    steps.push({ name: "ollama_tags", ok: false, detail: describeFetchError(e) });
    transportCode ??= fetchErrorCode(e);
    if (isOriginDead(e)) return originDeadResult(baseUrl, steps, transportCode);
  }

  // 3) Unsloth Studio model list — Ollama 다음 · OpenAI /v1/models 전.
  // 지문: 200 + `models` 배열 + `default_models` (LM Studio `/api/v1/models`와 경로가 다름).
  // 401은 Unsloth로 단정하지 않고 step만 남긴다 — 키 없이는 /v1/models로 떨어질 수 있다.
  try {
    const r = await fetchImpl(`${baseUrl}/api/models/list`, {
      headers: headers(opts.apiKey),
      signal: AbortSignal.timeout(timeoutMs),
    });
    steps.push({ name: "unsloth_models", ok: r.ok, status: r.status });
    if (r.ok) {
      let body: { models?: unknown[]; default_models?: unknown } | undefined;
      try {
        body = (await r.json()) as { models?: unknown[]; default_models?: unknown };
      } catch {
        annotateLastStep(steps, "invalid_json");
      }
      const modelsArr = Array.isArray(body?.models) ? body.models : undefined;
      const hasDefaultModels = body != null && "default_models" in body;
      if (modelsArr && hasDefaultModels) {
        const models = modelsArr
          .map((m) => m as UnslothListedModel)
          .filter((m) => typeof m.id === "string" && m.id)
          .filter((m) => !m.is_audio && !m.is_diffusion)
          .map((m) => {
            const id = m.id as string;
            return {
              id,
              label: (typeof m.name === "string" && m.name.trim() ? m.name.trim() : id) as string,
              publisher: resolvePublisher(id),
              kind: m.is_vision ? "vlm" : m.is_gguf ? "gguf" : m.is_mlx ? "mlx" : undefined,
            };
          })
          .filter((m) => !isBenchExcludedModelArtifact(m.id, m.label));
        if (models.length === 0) {
          annotateLastStep(steps, modelsArr.length === 0 ? "empty_model_list" : "no_benchable_model");
        }
        return {
          provider: "unsloth_studio",
          baseUrl,
          models,
          steps,
          capabilities: UNSLOTH_STUDIO_COMPAT_CAPS,
          reachability: reachOk,
        };
      }
      if (body) annotateLastStep(steps, "unrecognized_model_shape");
    } else if (r.status === 401) {
      annotateLastStep(steps, "unauthorized");
    }
  } catch (e) {
    steps.push({ name: "unsloth_models", ok: false, detail: describeFetchError(e) });
    transportCode ??= fetchErrorCode(e);
    if (isOriginDead(e)) return originDeadResult(baseUrl, steps, transportCode);
  }

  // 4) OpenAI-compatible list
  try {
    const r = await fetchImpl(`${baseUrl}/v1/models`, {
      headers: headers(opts.apiKey),
      signal: AbortSignal.timeout(timeoutMs),
    });
    steps.push({ name: "openai_models", ok: r.ok, status: r.status });
    if (r.ok) {
      const j = (await r.json()) as { data?: { id: string }[] };
      const arr = j.data;
      if (Array.isArray(arr) && arr.length > 0) {
        const models = arr
          .map((m) => {
            const row = m as { id: string; size?: number };
            return {
              id: row.id,
              label: row.id,
              publisher: resolvePublisher(row.id),
              size_bytes: typeof row.size === "number" && row.size > 0 ? row.size : undefined,
            };
          })
          .filter((m) => !isBenchExcludedModelArtifact(m.id, m.label));
        const caps = await probeCapabilities(fetchImpl, baseUrl, opts.apiKey, timeoutMs);
        const engine = await probeInferenceEngine(fetchImpl, baseUrl, opts.apiKey, timeoutMs, steps);
        return {
          provider: "openai_compatible",
          baseUrl,
          models,
          steps,
          capabilities: caps,
          reachability: reachOk,
          engine,
        };
      }
    }
  } catch (e) {
    steps.push({ name: "openai_models", ok: false, detail: describeFetchError(e) });
    transportCode ??= fetchErrorCode(e);
    if (isOriginDead(e)) return originDeadResult(baseUrl, steps, transportCode);
  }

  const caps = await probeCapabilities(fetchImpl, baseUrl, opts.apiKey, timeoutMs);
  const reachability = computeReachability(steps, transportCode);
  return {
    provider: "manual",
    baseUrl,
    models: [],
    steps,
    capabilities: caps,
    reachability,
  };
}

/** 엔드포인트 존재 여부 — 2xx 또는 bad-model 4xx/404+JSON. plain 404 route는 false. */
function routeLikelyAvailable(status: number, body: string): boolean {
  if (status >= 200 && status < 300) return true;
  if (status >= 400 && status < 500 && status !== 404) return true;
  if (status === 404 && body.trimStart().startsWith("{")) return true;
  return false;
}

/** SGLang `/server_info`·`/get_server_info` 본문 지문 — 일반 OpenAI `/v1`과 겹치지 않는 네이티브 필드. */
const SGLANG_INFO_MARKERS = [
  "internal_states",
  "schedule_conservativeness",
  "mem_fraction_static",
  "max_total_num_tokens",
] as const;

export function isSglangServerInfoBody(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const obj = body as Record<string, unknown>;
  if (typeof obj.version !== "string") return false;
  return SGLANG_INFO_MARKERS.some((k) => k in obj);
}

/** Prometheus 텍스트에서 OpenAI 호환 엔진을 단정. 우선순위: vllm → llamacpp → tgi. */
export function classifyMetricsEngine(text: string): InferenceEngine | null {
  if (
    text.includes("vllm:num_requests_running") ||
    text.includes("vllm:num_requests_waiting")
  ) {
    return "vllm";
  }
  if (
    text.includes("llamacpp:requests_processing") ||
    text.includes("llamacpp:requests_deferred")
  ) {
    return "llamacpp";
  }
  if (text.includes("tgi_batch_current_size") || text.includes("tgi_queue_size")) {
    return "tgi";
  }
  return null;
}

/**
 * `openai_compatible` 확정 후 엔진 힌트만 채운다(연결 시 1회).
 * 실패해도 null — 목록 성공을 뒤집지 않는다. LIST_STEP_NAMES에는 넣지 않음.
 */
async function probeInferenceEngine(
  fetchImpl: FetchLike,
  baseUrl: string,
  apiKey: string | undefined,
  timeoutMs: number,
  steps: DetectStep[],
): Promise<InferenceEngine | null> {
  const h = headers(apiKey);

  // 1) SGLang: /server_info (정본) → /get_server_info (레거시)
  for (const path of ["/server_info", "/get_server_info"] as const) {
    try {
      const r = await fetchImpl(`${baseUrl}${path}`, {
        headers: h,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) {
        steps.push({ name: "sglang_server_info", ok: false, status: r.status, detail: path });
        continue;
      }
      let body: unknown;
      try {
        body = await r.json();
      } catch {
        steps.push({
          name: "sglang_server_info",
          ok: false,
          status: r.status,
          detail: `${path}:invalid_json`,
        });
        continue;
      }
      if (isSglangServerInfoBody(body)) {
        steps.push({ name: "sglang_server_info", ok: true, status: r.status, detail: path });
        return "sglang";
      }
      steps.push({
        name: "sglang_server_info",
        ok: false,
        status: r.status,
        detail: `${path}:unrecognized_shape`,
      });
    } catch (e) {
      steps.push({
        name: "sglang_server_info",
        ok: false,
        detail: `${path}:${describeFetchError(e)}`,
      });
      // origin-dead여도 openai_compatible 반환은 유지 — 엔진만 null.
      break;
    }
  }

  // 2) /metrics 1회 — vllm / llamacpp / tgi 접두 분류
  try {
    const r = await fetchImpl(`${baseUrl}/metrics`, {
      headers: h,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      steps.push({ name: "vllm_metrics", ok: false, status: r.status });
      return null;
    }
    const text = await r.text().catch(() => "");
    const engine = classifyMetricsEngine(text);
    if (engine) {
      steps.push({ name: "vllm_metrics", ok: true, status: r.status, detail: engine });
      return engine;
    }
    steps.push({ name: "vllm_metrics", ok: false, status: r.status, detail: "no_known_gauges" });
  } catch (e) {
    steps.push({ name: "vllm_metrics", ok: false, detail: describeFetchError(e) });
  }
  return null;
}

/** Ollama·OpenAI 호환·manual 프로바이더용. LM Studio·Ollama는 네이티브 목록으로 식별 시 고정 caps를 씁니다. */
async function probeCapabilities(
  fetchImpl: FetchLike,
  baseUrl: string,
  apiKey?: string,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<{ openaiChat: boolean; anthropicMessages: boolean }> {
  const h = headers(apiKey);
  let openaiChat = false;
  let anthropicMessages = false;

  try {
    const r = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { ...h, "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: "probe-model",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
    });
    const body = await r.text().catch(() => "");
    openaiChat = routeLikelyAvailable(r.status, body);
  } catch {
    openaiChat = false;
  }

  try {
    const r = await fetchImpl(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        ...h,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: "probe-model",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    const body = await r.text().catch(() => "");
    anthropicMessages = routeLikelyAvailable(r.status, body);
  } catch {
    anthropicMessages = false;
  }

  return { openaiChat, anthropicMessages };
}
