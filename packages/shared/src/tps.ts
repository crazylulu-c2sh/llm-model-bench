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
