import type { McpConfig } from "./config.js";

/** 에러 메시지에 실을 응답 본문의 상한 — 전문을 넣으면 도구 결과가 스택트레이스 덤프가 된다. */
const ERROR_BODY_MAX_CHARS = 500;

/**
 * non-2xx 응답. 본문을 버리지 않고 들고 다닌다 — 벤치 API의 거부는 대부분 "왜"가 본문에만 있고
 * (예: 409 `queue_active`의 queue_id/model_id), 상태 코드만으로는 호출자가 재시도 여부를 정할 수 없다.
 */
export class BenchHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 원문(상한 적용 전). 파싱 실패 시에도 남는다. */
    readonly body: string,
    /** 본문이 JSON 객체였을 때만. 호출자가 `error` 코드로 분기할 수 있게 그대로 보관. */
    readonly payload?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BenchHttpError";
  }
}

/** 이 에러가 "서버 큐가 baseUrl을 점유 중"(POST /bench/stream 409)인가. */
export function isQueueActiveError(e: unknown): e is BenchHttpError {
  return e instanceof BenchHttpError && e.status === 409 && e.payload?.error === "queue_active";
}

function clip(s: string): string {
  return s.length > ERROR_BODY_MAX_CHARS ? `${s.slice(0, ERROR_BODY_MAX_CHARS)}…` : s;
}

/**
 * 본문을 사람이 읽을 수 있는 한 줄로. JSON이면 `error`/`message`를 앞세우고 나머지 스칼라 필드를
 * `k=v`로 붙인다 — queue_id·base_url 같은 값이 그대로 후속 행동(어떤 큐를 기다릴지)의 근거가 되기 때문.
 */
function describeErrorBody(text: string): { detail: string; payload?: Record<string, unknown> } {
  const trimmed = text.trim();
  if (!trimmed) return { detail: "" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { detail: clip(trimmed) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { detail: clip(trimmed) };
  }
  const payload = parsed as Record<string, unknown>;
  const head: string[] = [];
  const { error, message } = payload;
  if (typeof error === "string") head.push(error);
  else if (error != null) head.push(JSON.stringify(error));
  if (typeof message === "string" && message) head.push(message);
  const extras = Object.entries(payload)
    .filter(([k, v]) => k !== "error" && k !== "message" && (v === null || typeof v !== "object"))
    .map(([k, v]) => `${k}=${v === null ? "null" : String(v)}`);
  const joined = [head.join(": "), extras.length ? `(${extras.join(", ")})` : ""]
    .filter(Boolean)
    .join(" ");
  return { detail: clip(joined || trimmed), payload };
}

async function httpError(method: string, path: string, r: Response): Promise<BenchHttpError> {
  const text = await r.text().catch(() => "");
  const { detail, payload } = describeErrorBody(text);
  return new BenchHttpError(
    `${method} ${path} → ${r.status}${detail ? ` ${detail}` : ""}`,
    r.status,
    text,
    payload,
  );
}

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
    if (!r.ok) throw await httpError("GET", path, r);
    return (await r.json()) as T;
  }

  async postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    const r = await fetch(this.url(path), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw await httpError("POST", path, r);
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
    if (!r.ok) throw await httpError("POST", path, r);
    if (!r.body) throw new Error(`POST ${path} → ${r.status} (no stream body)`);
    return r;
  }
}
