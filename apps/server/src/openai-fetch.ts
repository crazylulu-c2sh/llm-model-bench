/**
 * OpenAI chat completions POST helper —
 *   1) `stream_options: { include_usage: true }`를 주입해 streamed `usage` 청크를 받게 한다.
 *   2) base_url이 400으로 거절하면 한 번 stream_options를 제거하고 재시도한다.
 *   3) 재시도 발생 시 해당 base_url을 글로벌 캐시에 기록해 같은 프로세스에서는 다시 시도하지 않는다.
 */

const baseUrlsRejectingStreamOptions = new Set<string>();

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").toLowerCase();
}

export function shouldIncludeStreamUsage(baseUrl: string): boolean {
  return !baseUrlsRejectingStreamOptions.has(normalizeBaseUrl(baseUrl));
}

export function markBaseUrlAsRejectingStreamUsage(baseUrl: string): void {
  baseUrlsRejectingStreamOptions.add(normalizeBaseUrl(baseUrl));
}

/** 테스트 용 — 캐시 초기화. */
export function _resetStreamUsageCacheForTests(): void {
  baseUrlsRejectingStreamOptions.clear();
}

export function injectStreamUsage(
  body: Record<string, unknown>,
  baseUrl: string,
): Record<string, unknown> {
  if (!shouldIncludeStreamUsage(baseUrl)) return body;
  if (body.stream !== true) return body;
  return { ...body, stream_options: { include_usage: true } };
}

/** 400 본문이 stream_options/include_usage를 시사하면 true (휴리스틱). */
export function looksLikeStreamUsageRejection(status: number, body: string): boolean {
  if (status !== 400) return false;
  return /stream_options|include_usage|unknown\s*(field|parameter|argument|property)/i.test(body);
}

/**
 * `fetch`를 1회 또는 (400 + heuristic 시) 2회 호출한다.
 * 호출자에는 *최종* Response를 돌려준다. 두 번째 호출은 `stream_options`를 제거한다.
 */
export async function openAiChatPostWithUsage(
  fetchImpl: typeof fetch,
  url: string,
  baseUrl: string,
  headers: HeadersInit,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ response: Response; usedStreamOptions: boolean; retriedAfterStreamOptionsRejection: boolean }> {
  const initialBody = injectStreamUsage(body, baseUrl);
  const usedStreamOptions = initialBody.stream_options != null;
  const first = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(initialBody),
    signal,
  });
  if (!usedStreamOptions || first.status !== 400) {
    return { response: first, usedStreamOptions, retriedAfterStreamOptionsRejection: false };
  }
  const errText = await first.clone().text().catch(() => "");
  if (!looksLikeStreamUsageRejection(first.status, errText)) {
    return { response: first, usedStreamOptions, retriedAfterStreamOptionsRejection: false };
  }
  markBaseUrlAsRejectingStreamUsage(baseUrl);
  const { stream_options: _stripped, ...rest } = initialBody as Record<string, unknown> & {
    stream_options?: unknown;
  };
  void _stripped;
  const second = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(rest),
    signal,
  });
  return { response: second, usedStreamOptions: false, retriedAfterStreamOptionsRejection: true };
}
