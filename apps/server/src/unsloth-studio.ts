import type { FetchLike } from "./detect.js";
import { stripDocumentedApiBaseSuffix } from "./http-shared.js";
import { providerFetch } from "./provider-fetch.js";

function headers(apiKey?: string): HeadersInit {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

/** 문서화된 `/v1` 접미사를 벗겨 Studio 오리진 루트를 얻는다. */
function apiRoot(baseUrl: string): string {
  return stripDocumentedApiBaseSuffix(baseUrl.replace(/\/+$/, ""));
}

/** GGUF 로드는 수분 걸릴 수 있음 — 터널 패딩 응답까지 본문을 전부 소비한다. */
export const UNSLOTH_LOAD_TIMEOUT_MS = 600_000;
export const UNSLOTH_UNLOAD_TIMEOUT_MS = 300_000;
export const UNSLOTH_STATUS_TIMEOUT_MS = 10_000;

export type UnslothPrepareLabel = "loaded" | "already_in_memory" | "load_skipped_by_request";

export type UnslothPrepareResult = {
  prepare: UnslothPrepareLabel;
  loadedByThisRun: boolean;
  error?: { ok: false; status: number; body: string };
};

export type UnslothListedModel = {
  id: string;
  name?: string | null;
  is_audio?: boolean;
  is_diffusion?: boolean;
  is_vision?: boolean;
  is_gguf?: boolean;
  is_mlx?: boolean;
};

export type UnslothInferenceStatus = {
  active_model: string | null;
  model_identifier?: string | null;
  loaded: string[];
  loading: string[];
  context_length?: number | null;
};

/**
 * `repo:VARIANT` → `{ model_path, gguf_variant }`.
 * 콜론이 없으면 variant 없이 model_path만. `C:\...` 같은 Windows 경로는 콜론이 드라이브에만
 * 있으므로 `:/`·`:\` 직후이거나 길이 1이면 분리하지 않는다.
 */
export function splitUnslothModelId(modelId: string): {
  model_path: string;
  gguf_variant?: string;
} {
  const trimmed = modelId.trim();
  const colon = trimmed.indexOf(":");
  if (colon <= 0) return { model_path: trimmed };
  // Windows drive letter (`C:\…`) — not a GGUF variant separator.
  if (colon === 1 && /^[A-Za-z]$/.test(trimmed[0]!)) return { model_path: trimmed };
  const after = trimmed.slice(colon + 1);
  if (!after || after.startsWith("/") || after.startsWith("\\")) return { model_path: trimmed };
  return { model_path: trimmed.slice(0, colon), gguf_variant: after };
}

/** 상주 여부 비교 — status의 active/loaded id와 벤치 modelId(또는 repo 부분)를 맞춘다. */
export function unslothModelIdsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = splitUnslothModelId(a).model_path;
  const pb = splitUnslothModelId(b).model_path;
  return pa === pb || pa === b || pb === a;
}

export async function unslothListModels(
  baseUrl: string,
  opts: { fetchImpl?: FetchLike; apiKey?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; models: UnslothListedModel[]; body: string }> {
  const fetchImpl = opts.fetchImpl ?? providerFetch;
  const timeoutMs = opts.timeoutMs ?? UNSLOTH_STATUS_TIMEOUT_MS;
  try {
    const r = await fetchImpl(`${apiRoot(baseUrl)}/api/models/list`, {
      headers: headers(opts.apiKey),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const t = await r.text();
    if (!r.ok) return { ok: false, status: r.status, models: [], body: t.slice(0, 2000) };
    let parsed: { models?: unknown[]; default_models?: unknown };
    try {
      parsed = JSON.parse(t) as { models?: unknown[]; default_models?: unknown };
    } catch {
      return { ok: false, status: r.status, models: [], body: "invalid_json" };
    }
    if (!Array.isArray(parsed.models) || !("default_models" in parsed)) {
      return { ok: false, status: r.status, models: [], body: "unrecognized_model_shape" };
    }
    const models: UnslothListedModel[] = [];
    for (const row of parsed.models) {
      if (!row || typeof row !== "object") continue;
      const m = row as UnslothListedModel;
      if (typeof m.id !== "string" || !m.id) continue;
      models.push(m);
    }
    return { ok: true, status: r.status, models, body: t.slice(0, 2000) };
  } catch (e) {
    return { ok: false, status: 0, models: [], body: String(e).slice(0, 500) };
  }
}

export async function unslothInferenceStatus(
  baseUrl: string,
  opts: { fetchImpl?: FetchLike; apiKey?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; statusBody?: UnslothInferenceStatus; body: string }> {
  const fetchImpl = opts.fetchImpl ?? providerFetch;
  const timeoutMs = opts.timeoutMs ?? UNSLOTH_STATUS_TIMEOUT_MS;
  try {
    const r = await fetchImpl(`${apiRoot(baseUrl)}/api/inference/status`, {
      headers: headers(opts.apiKey),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const t = await r.text();
    if (!r.ok) return { ok: false, status: r.status, body: t.slice(0, 2000) };
    let parsed: UnslothInferenceStatus;
    try {
      const j = JSON.parse(t) as Partial<UnslothInferenceStatus>;
      parsed = {
        active_model: typeof j.active_model === "string" ? j.active_model : null,
        model_identifier: typeof j.model_identifier === "string" ? j.model_identifier : null,
        loaded: Array.isArray(j.loaded) ? j.loaded.filter((x): x is string => typeof x === "string") : [],
        loading: Array.isArray(j.loading)
          ? j.loading.filter((x): x is string => typeof x === "string")
          : [],
        context_length: typeof j.context_length === "number" ? j.context_length : null,
      };
    } catch {
      return { ok: false, status: r.status, body: "invalid_json" };
    }
    return { ok: true, status: r.status, statusBody: parsed, body: t.slice(0, 2000) };
  } catch (e) {
    return { ok: false, status: 0, body: String(e).slice(0, 500) };
  }
}

export async function unslothLoad(
  baseUrl: string,
  modelId: string,
  opts: {
    fetchImpl?: FetchLike;
    apiKey?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    /** 벤치 경로: 생성 중 409를 피하려면 true. 모니터 수동 load는 false. */
    forceCancelActive?: boolean;
  } = {},
): Promise<{ ok: boolean; status: number; body: string }> {
  const fetchImpl = opts.fetchImpl ?? providerFetch;
  const timeoutMs = opts.timeoutMs ?? UNSLOTH_LOAD_TIMEOUT_MS;
  const { model_path, gguf_variant } = splitUnslothModelId(modelId);
  const payload: Record<string, unknown> = {
    model_path,
    load_in_4bit: true,
    max_seq_length: 0,
    is_lora: false,
  };
  if (gguf_variant) payload.gguf_variant = gguf_variant;
  if (opts.forceCancelActive) payload.force_cancel_active = true;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal =
    opts.signal != null ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;

  try {
    const r = await fetchImpl(`${apiRoot(baseUrl)}/api/inference/load`, {
      method: "POST",
      headers: headers(opts.apiKey),
      body: JSON.stringify(payload),
      signal,
    });
    // 터널 패딩은 StreamingResponse일 수 있으므로 본문을 전부 소비한다.
    const t = await r.text();
    return { ok: r.ok, status: r.status, body: t.slice(0, 2000) };
  } catch (e) {
    return { ok: false, status: 0, body: String(e).slice(0, 500) };
  }
}

export async function unslothUnload(
  baseUrl: string,
  modelId: string,
  opts: {
    fetchImpl?: FetchLike;
    apiKey?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    forceCancelActive?: boolean;
  } = {},
): Promise<{ ok: boolean; status: number; body: string }> {
  const fetchImpl = opts.fetchImpl ?? providerFetch;
  const timeoutMs = opts.timeoutMs ?? UNSLOTH_UNLOAD_TIMEOUT_MS;
  const { model_path } = splitUnslothModelId(modelId);
  const payload: Record<string, unknown> = { model_path };
  if (opts.forceCancelActive) payload.force_cancel_active = true;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal =
    opts.signal != null ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;

  try {
    const r = await fetchImpl(`${apiRoot(baseUrl)}/api/inference/unload`, {
      method: "POST",
      headers: headers(opts.apiKey),
      body: JSON.stringify(payload),
      signal,
    });
    const t = await r.text();
    return { ok: r.ok, status: r.status, body: t.slice(0, 2000) };
  } catch (e) {
    return { ok: false, status: 0, body: String(e).slice(0, 500) };
  }
}

function isResident(status: UnslothInferenceStatus, modelId: string): boolean {
  const candidates = [status.active_model, status.model_identifier, ...status.loaded].filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  return candidates.some((c) => unslothModelIdsMatch(c, modelId));
}

/**
 * 벤치/스트레스 공용 Unsloth Studio 준비.
 * skip → 이미 상주 → (옵션) 다른 활성 모델 unload → load.
 */
export async function prepareUnslothStudioForRun(opts: {
  baseUrl: string;
  modelId: string;
  skipModelLoad: boolean;
  unloadOtherModels?: boolean;
  fetchImpl?: FetchLike;
  apiKey?: string;
  signal?: AbortSignal;
  /** 벤치 기본 true — 생성 중 409 회피. */
  forceCancelActive?: boolean;
}): Promise<UnslothPrepareResult> {
  const {
    baseUrl,
    modelId,
    skipModelLoad,
    unloadOtherModels,
    fetchImpl,
    apiKey,
    signal,
    forceCancelActive = true,
  } = opts;

  if (skipModelLoad) {
    return { prepare: "load_skipped_by_request", loadedByThisRun: false };
  }

  const st = await unslothInferenceStatus(baseUrl, { fetchImpl, apiKey });
  if (st.ok && st.statusBody && isResident(st.statusBody, modelId)) {
    return { prepare: "already_in_memory", loadedByThisRun: false };
  }

  if (signal?.aborted) {
    return { prepare: "load_skipped_by_request", loadedByThisRun: false };
  }

  if (unloadOtherModels && st.ok && st.statusBody) {
    const active = st.statusBody.active_model ?? st.statusBody.model_identifier;
    if (active && !unslothModelIdsMatch(active, modelId)) {
      await unslothUnload(baseUrl, active, { fetchImpl, apiKey, signal, forceCancelActive });
    }
  }

  if (signal?.aborted) {
    return { prepare: "load_skipped_by_request", loadedByThisRun: false };
  }

  const load = await unslothLoad(baseUrl, modelId, {
    fetchImpl,
    apiKey,
    signal,
    forceCancelActive,
  });
  if (!load.ok) {
    return {
      prepare: "loaded",
      loadedByThisRun: false,
      error: { ok: false as const, status: load.status, body: load.body },
    };
  }
  return { prepare: "loaded", loadedByThisRun: true };
}
