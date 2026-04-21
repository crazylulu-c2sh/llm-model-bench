import type { FetchLike } from "./detect.js";

function headers(apiKey?: string): HeadersInit {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
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
