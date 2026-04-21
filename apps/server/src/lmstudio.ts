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

function baseKey(modelKey: string): string {
  return modelKey.replace(/:\d+$/, "");
}

export async function lmStudioListModels(
  baseUrl: string,
  opts: { fetchImpl?: FetchLike; apiKey?: string } = {},
): Promise<{ ok: boolean; status: number; models: LmStudioListedModel[]; body: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const candidates = [
    `${baseUrl}/api/v1/models`,
    `${baseUrl}/api/v0/models`,
  ];
  for (const url of candidates) {
    const r = await fetchImpl(url, {
      headers: headers(opts.apiKey),
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
  const candidates = [
    `${baseUrl}/api/v1/models/load`,
    `${baseUrl}/api/v0/models/load`,
  ];
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

export async function lmStudioUnload(
  baseUrl: string,
  modelKey: string,
  opts: { fetchImpl?: FetchLike; apiKey?: string } = {},
): Promise<{ ok: boolean; status: number; body: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const candidates = [
    `${baseUrl}/api/v1/models/unload`,
    `${baseUrl}/api/v0/models/unload`,
  ];
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
  return { ok: false, status: 404, body: "no unload endpoint" };
}
