import {
  isBenchExcludedModelArtifact,
  parseModelPublisherFromId,
  type DetectResult,
  type DetectStep,
  type ProviderKind,
  type Reachability,
  type ReachabilityCode,
} from "@llm-bench/shared";

export type FetchLike = typeof fetch;

/**
 * API `publisher` 우선, 없으면 id의 `org/` 접두. 둘 다 없으면 undefined.
 * detect 응답을 만들 때와 런 meta를 기록할 때가 같은 규칙을 써야 하므로 러너도 이걸 쓴다.
 */
export function resolvePublisher(modelId: string, apiPublisher?: string | null): string | undefined {
  if (typeof apiPublisher === "string" && apiPublisher.trim()) return apiPublisher.trim();
  return parseModelPublisherFromId(modelId);
}

const LIST_STEP_NAMES = ["lm_studio_list", "ollama_tags", "openai_models"] as const;

/**
 * 문서에 적힌 API 베이스를 서버 루트로 맞춤 — 이 앱은 `base + /v1/...`와 `base + /api/v1/...`을 직접 조합합니다.
 * OpenAI 호환 `…/v1`뿐 아니라 LM Studio가 안내하는 `…/api/v1`·`…/api/v0`도 그대로 두면 경로가 두 번 붙어
 * 죽은 주소를 찌르게 됩니다. LM Studio는 모르는 경로에도 200을 주므로 그 오진이 조용히 성공처럼 보입니다.
 */
function stripDocumentedApiBaseSuffix(u: string): string {
  const strip = (path: string): string => path.replace(/\/api\/v[01]$/i, "").replace(/\/v1$/i, "");
  try {
    const url = new URL(u);
    const path = url.pathname.replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
    url.pathname = strip(path) || "/";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return strip(u);
  }
}

function normalizeBaseUrl(raw: string): string {
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

export async function detectProvider(
  rawBaseUrl: string,
  opts: {
    fetchImpl?: FetchLike;
    apiKey?: string;
    manual?: { provider: ProviderKind; models?: { id: string; label?: string }[] };
    timeoutMs?: number;
  } = {},
): Promise<DetectResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
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
        const models = modelsArr
          .map((m) => m as LmStudioNativeModel)
          .filter((m) => typeof m.key === "string" && m.key)
          .filter((m) => m.type === "llm" || !m.type)
          .filter((m) => !isBenchExcludedModelArtifact(m.key as string, m.display_name))
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

  // 3) OpenAI-compatible list
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
        return {
          provider: "openai_compatible",
          baseUrl,
          models,
          steps,
          capabilities: caps,
          reachability: reachOk,
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
