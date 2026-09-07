/**
 * Anthropic messages POST helper — `openai-fetch.ts`의 `stream_options` 400-재시도와 같은 모양이다.
 *
 *   1) 프로필 의도가 사고 ON이면 `thinking: { type: "enabled", budget_tokens }`를 주입한다.
 *   2) 업스트림이 이를 거절하면 한 번 `thinking`을 빼고 재시도한다.
 *   3) 재시도가 발생한 base_url은 프로세스 캐시에 남겨 다시 시도하지 않는다.
 *
 * #173: LM Studio는 `thinking` 없이는 추론을 스트림에 내보내지 않아(모델에 따라 아예 추론을 하지
 * 않거나, 하고도 델타를 버린다) `messages` 라우트의 TTFT가 추론 구간을 통째로 삼켰다. 실측상
 * LM Studio는 400을 내지 않지만, 벤치는 임의의 `openai_compatible`/manual base URL도 받으므로
 * 폴백이 없으면 `!r.ok` 한 번에 시나리오가 죽는다.
 */

import { baseUrlCacheKey } from "./http-shared.js";

const baseUrlsRejectingThinking = new Set<string>();

/** `budget_tokens` 최솟값(Anthropic 규약). 이보다 작게는 요청할 수 없다. */
export const ANTHROPIC_MIN_THINKING_BUDGET = 1024;
/** `budget_tokens < max_tokens` 여야 하므로 본문 몫으로 남겨 두는 여유. */
const VISIBLE_TOKEN_HEADROOM = 512;

export function shouldRequestThinking(baseUrl: string): boolean {
  if (process.env.BENCH_ANTHROPIC_THINKING === "0") return false;
  return !baseUrlsRejectingThinking.has(baseUrlCacheKey(baseUrl));
}

export function markBaseUrlAsRejectingThinking(baseUrl: string): void {
  baseUrlsRejectingThinking.add(baseUrlCacheKey(baseUrl));
}

/** 테스트 용 — 캐시 초기화. */
export function _resetThinkingCacheForTests(): void {
  baseUrlsRejectingThinking.clear();
}

/**
 * `1024 ≤ budget_tokens < max_tokens`를 만족하는 예산. 여유가 없으면 null(필드 자체를 생략).
 *
 * #174 이후 요청 레벨 상한이 실제로 도착하므로 이 분기가 살아난다 — `max_tokens: 20`·`293` 같은
 * 값에서는 사고를 요청하지 않는 것이 맞다.
 */
export function thinkingBudgetTokens(maxTokens: number): number | null {
  if (!Number.isFinite(maxTokens)) return null;
  const cap = Math.floor(maxTokens) - VISIBLE_TOKEN_HEADROOM;
  if (cap < ANTHROPIC_MIN_THINKING_BUDGET) return null;
  return Math.max(ANTHROPIC_MIN_THINKING_BUDGET, Math.min(cap, Math.floor(maxTokens / 2)));
}

/** 업스트림 응답이 `thinking` 거절로 보이면 true (휴리스틱). */
export function looksLikeThinkingRejection(status: number, body: string): boolean {
  if (status < 400) return false;
  return /thinking|budget_tokens|extended[_ ]thinking|unknown\s*(field|parameter|argument|property)/i.test(
    body,
  );
}

/**
 * `fetch`를 1회 또는 (거절 heuristic 시) 2회 호출한다. 호출자에는 *최종* Response를 돌려준다.
 *
 * `openai-fetch`와 달리 400뿐 아니라 5xx에서도 재시도한다 — 알 수 없는 필드에 500을 내는 shim이
 * 있으면 멀쩡히 돌던 런이 통째로 실패하기 때문이다. 재시도는 base_url당 한 번뿐이다.
 */
export async function anthropicMessagesPostWithThinking(
  fetchImpl: typeof fetch,
  url: string,
  baseUrl: string,
  headers: HeadersInit,
  body: Record<string, unknown>,
  thinking: { type: "enabled"; budget_tokens: number } | null,
  signal?: AbortSignal,
): Promise<{ response: Response; usedThinking: boolean; retriedAfterThinkingRejection: boolean }> {
  const wantThinking = thinking != null && shouldRequestThinking(baseUrl);
  const initialBody = wantThinking ? { ...body, thinking } : body;
  const first = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(initialBody),
    signal,
  });
  if (!wantThinking || first.ok) {
    return { response: first, usedThinking: wantThinking, retriedAfterThinkingRejection: false };
  }
  const errText = await first.clone().text().catch(() => "");
  const retryable = looksLikeThinkingRejection(first.status, errText) || first.status >= 500;
  if (!retryable) {
    return { response: first, usedThinking: wantThinking, retriedAfterThinkingRejection: false };
  }
  markBaseUrlAsRejectingThinking(baseUrl);
  const second = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  return { response: second, usedThinking: false, retriedAfterThinkingRejection: true };
}
