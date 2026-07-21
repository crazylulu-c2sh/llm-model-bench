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
 * `ttlSeconds`(>0) 지정 시 payload에 `ttl`(초)을 실어 idle 후 자동 언로드(자동-이빅트)를 건다.
 */
export async function lmStudioLoad(
  baseUrl: string,
  modelKey: string,
  opts: { fetchImpl?: FetchLike; apiKey?: string; ttlSeconds?: number } = {},
): Promise<{ ok: boolean; status: number; body: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const root = apiRoot(baseUrl);
  const candidates = [`${root}/api/v1/models/load`, `${root}/api/v0/models/load`];
  const ttl =
    typeof opts.ttlSeconds === "number" && Number.isFinite(opts.ttlSeconds) && opts.ttlSeconds > 0
      ? Math.floor(opts.ttlSeconds)
      : undefined;
  const body = JSON.stringify(ttl != null ? { model: modelKey, ttl } : { model: modelKey });
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
