import type { McpConfig } from "./config.js";

/**
 * 벤치 HTTP API의 얇은 클라이언트. 모든 요청은 `${benchApiUrl}${apiVersion}` (canonical `/api/v1`)로 가고,
 * `BENCH_API_KEY`가 있으면 `Authorization: Bearer`를 붙인다(벤치 서버 인증 — provider apiKey와 별개).
 */
export class BenchClient {
  constructor(private readonly cfg: McpConfig) {}

  private url(path: string): string {
    return `${this.cfg.benchApiUrl}${this.cfg.apiVersion}${path}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json", ...extra };
    if (this.cfg.benchApiKey) h.Authorization = `Bearer ${this.cfg.benchApiKey}`;
    return h;
  }

  async getJson<T = unknown>(path: string): Promise<T> {
    const r = await fetch(this.url(path), { headers: this.headers() });
    if (!r.ok) {
      throw new Error(`GET ${path} → ${r.status} ${(await r.text().catch(() => "")).slice(0, 300)}`);
    }
    return (await r.json()) as T;
  }

  async postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    const r = await fetch(this.url(path), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      throw new Error(`POST ${path} → ${r.status} ${(await r.text().catch(() => "")).slice(0, 300)}`);
    }
    return (await r.json()) as T;
  }

  /** SSE 스트림용 — Response(body ReadableStream)를 그대로 반환한다(호출자가 드레인). */
  async postStream(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const r = await fetch(this.url(path), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    });
    if (!r.ok || !r.body) {
      throw new Error(`POST ${path} → ${r.status} (no stream body)`);
    }
    return r;
  }
}
