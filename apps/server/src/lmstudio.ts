import type { FetchLike } from "./detect.js";

function headers(apiKey?: string): HeadersInit {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

type LmStudioListedModel = {
  key?: string;
  loaded_instances?: unknown[];
};

function apiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function baseKey(modelKey: string): string {
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
  for (const url of candidates) {
    const r = await fetchImpl(url, {
      headers: headers(opts.apiKey),
      ...(timeoutMs != null ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
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

/** LM Studio REST load — tries common paths; body uses model key from List API. */
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
