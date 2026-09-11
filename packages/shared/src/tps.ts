/**
 * 서버 `scenario_end.metrics.approx_tokens`·웹 `tokensPerSecondFromRun`와 동일 산식.
 * provider가 `usage.completion_tokens`를 주지 않을 때 fallback.
 */
export function approxOutputTokens(outputText: string | null | undefined): number {
  return Math.max(0, Math.ceil((outputText ?? "").length / 4));
}

/**
 * 처리량(TPS) 산식에 쓸 출력 토큰 수.
 * provider 보고 실토큰(`usageTokens`)이 있으면(>0) 그것을, 없으면 글자수/4 근사를 쓴다.
 * 보고된 `0`/`null`은 신뢰하지 않고 근사로 폴백(stress-runner의 `>0` 가드와 동일).
 */
export function effectiveOutputTokens(
  outputText: string | null | undefined,
  usageTokens: number | null | undefined,
): number {
  if (usageTokens != null && usageTokens > 0) return usageTokens;
  return approxOutputTokens(outputText ?? "");
}

/** 실토큰 사용 여부 라벨 — UI 소스 표기·경고에 사용. */
export function tpsSourceFromUsage(usageTokens: number | null | undefined): "usage" | "approx" {
  return usageTokens != null && usageTokens > 0 ? "usage" : "approx";
}

export function outputTokensFromRun(
  outputText: string | null | undefined,
  usageTokens?: number | null,
): number | null {
  const n = effectiveOutputTokens(outputText ?? "", usageTokens);
  return n > 0 ? n : null;
}

export function tokensPerSecondFromRun(
  totalMs: number | null | undefined,
  outputText: string | null | undefined,
  usageTokens?: number | null,
): number {
  const ms = totalMs ?? 0;
  if (!ms || ms <= 0) return 0;
  const at = effectiveOutputTokens(outputText ?? "", usageTokens);
  if (at <= 0) return 0;
  return at / (ms / 1000);
}

/** UI가 어떤 TPS 축을 그리는지. `wall`은 blended(`tokensPerSecondFromRun`) — 기본 UI에서는 숨김. */
export type TpsKind = "wall" | "decode" | "prefill";

/**
 * 디코드 TPS — llama.cpp / oMLX 관례.
 * 분모: `total_ms - ttft_ms`. 분자: `max(0, output_tokens - 1)` (첫 토큰은 프리필+샘플에 포함).
 * `ttft` 없음 / decode_ms ≤ 0 / 출력 토큰 ≤ 1 → null.
 */
export function decodeTokensPerSecondFromRun(input: {
  totalMs: number | null | undefined;
  ttftMs: number | null | undefined;
  outputText?: string | null;
  usageTokens?: number | null;
}): number | null {
  const totalMs = input.totalMs ?? 0;
  const ttftMs = input.ttftMs;
  if (ttftMs == null || !Number.isFinite(ttftMs) || ttftMs < 0) return null;
  if (!totalMs || totalMs <= 0) return null;
  const decodeMs = totalMs - ttftMs;
  if (!(decodeMs > 0)) return null;
  const at = effectiveOutputTokens(input.outputText ?? "", input.usageTokens);
  if (at <= 1) return null;
  return (at - 1) / (decodeMs / 1000);
}

/**
 * 프리필 TPS — `prompt_tokens / (ttft_ms / 1000)`.
 * `promptTokens`가 없으면 근사하지 않고 null (구 런·usage 미보고).
 */
export function prefillTokensPerSecondFromRun(
  ttftMs: number | null | undefined,
  promptTokens: number | null | undefined,
): number | null {
  if (ttftMs == null || !Number.isFinite(ttftMs) || ttftMs <= 0) return null;
  if (promptTokens == null || !Number.isFinite(promptTokens) || promptTokens <= 0) return null;
  return promptTokens / (ttftMs / 1000);
}

/** 표·차트 표시용 소수 1자리. 비양수/비유한은 null. */
export function roundTpsDisplay(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10) / 10;
}
