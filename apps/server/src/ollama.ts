import type { FetchLike } from "./detect.js";

function headers(apiKey?: string): HeadersInit {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

function apiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** 로드 대기 여유(대형 모델 첫 로드는 수십 초 걸릴 수 있음). */
const OLLAMA_LOAD_TIMEOUT_MS = 120_000;

/**
 * Ollama 네이티브 `/api/generate`로 모델을 **로드만** 하고 `keep_alive`(TTL)를 건다.
 *
 * - `keep_alive`는 네이티브 `/api/generate`·`/api/chat`에서만 동작한다. 벤치 추론이 나가는
 *   OpenAI 호환 `/v1/chat/completions`는 `keep_alive`를 무시하고 매 요청마다 기본 5분으로 리셋하므로
 *   (ollama#11458), (1) 시작 preload + (2) 벤치 종료 후 재적용에 **이 함수를 그대로 재사용**한다.
 * - 빈 prompt를 보내면 생성 없이 모델만 메모리에 올라간다(응답 `done_reason: "load"`).
 * - `keep_alive`는 `"<초>s"` Go duration 문자열로 보내 숫자 해석 모호성을 없앤다.
 * - best-effort: 네트워크/업스트림 실패는 throw하지 않고 `{ ok:false }`로 반환한다.
 */
export async function ollamaKeepAliveLoad(
  baseUrl: string,
  model: string,
  opts: { ttlSeconds: number; fetchImpl?: FetchLike; apiKey?: string },
): Promise<{ ok: boolean; status: number; body: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${apiRoot(baseUrl)}/api/generate`;
  const seconds = Math.floor(opts.ttlSeconds);
  const body = JSON.stringify({
    model,
    prompt: "",
    stream: false,
    keep_alive: `${seconds}s`,
  });
  try {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: headers(opts.apiKey),
      body,
      signal: AbortSignal.timeout(OLLAMA_LOAD_TIMEOUT_MS),
    });
    const t = await r.text();
    return { ok: r.ok, status: r.status, body: t.slice(0, 2000) };
  } catch (e) {
    return { ok: false, status: 0, body: String(e).slice(0, 500) };
  }
}
