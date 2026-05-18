/**
 * 서버 `scenario_end.metrics.approx_tokens`·웹 `tokensPerSecondFromRun`와 동일 산식.
 * provider가 `usage.completion_tokens`를 주지 않을 때 fallback.
 */
export function approxOutputTokens(outputText: string | null | undefined): number {
  return Math.max(0, Math.ceil((outputText ?? "").length / 4));
}

export function tokensPerSecondFromRun(
  totalMs: number | null | undefined,
  outputText: string | null | undefined,
): number {
  const ms = totalMs ?? 0;
  if (!ms || ms <= 0) return 0;
  const at = approxOutputTokens(outputText ?? "");
  if (at <= 0) return 0;
  return at / (ms / 1000);
}
