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

/** 스트림에서 처음 도착한 출력 델타의 종류 — `scenario_end.metrics.first_output_kind`와 값 집합 동일. */
export const FIRST_OUTPUT_KINDS = ["text", "reasoning", "tool_call"] as const;
export type FirstOutputKind = (typeof FIRST_OUTPUT_KINDS)[number];

/**
 * 디코드 구간이 이보다 짧으면 출력이 한 번에 몰려 온(single burst) 것으로 보고 디코드 TPS를 버린다.
 * 기존 DB(7,568 런) 실측: 10 ms 미만 502건 중 484건이 1,000 tok/s 이상(도구 호출 한 덩어리·확산 모델·
 * 짧은 핑)이고, 600 tok/s 미만은 출력 2토큰(토큰 간격 1개)짜리 6건뿐이었다. 20 ms로 올리면
 * 0.5B~1B 모델의 짧은 정상 응답(470~550 tok/s)까지 버리게 되어 10 ms를 보수적 하한으로 둔다.
 */
export const MIN_DECODE_WINDOW_MS = 10;

/**
 * 한 런의 출력이 몇 번의 read 배치에 걸쳐 왔는지(`output_delta_batches`)와 첫 출력 종류.
 * 서버 스트림 파서가 기록한다. 구 런에는 없다(undefined/null).
 */
export type OutputBurstInput = {
  outputDeltaBatches?: number | null;
  firstOutputKind?: FirstOutputKind | null;
};

/**
 * 디코드 TPS — llama.cpp / oMLX 관례.
 * 분모: `total_ms - ttft_ms`. 분자: `max(0, output_tokens - 1)` (첫 토큰은 프리필+샘플에 포함).
 * `ttft` 없음 / decode_ms ≤ 0 / 출력 토큰 ≤ 1 → null.
 * 단일 버스트도 null: 출력 델타가 read 배치 1개 이하로 왔거나(`outputDeltaBatches ≤ 1`),
 * decode_ms가 `MIN_DECODE_WINDOW_MS` 미만이면(배치 수가 없는 구 런도 이 하한으로 걸러진다)
 * 분모가 네트워크 지연 수 ms뿐이라 수천~수백만 tok/s가 나온다.
 */
export function decodeTokensPerSecondFromRun(input: {
  totalMs: number | null | undefined;
  ttftMs: number | null | undefined;
  outputText?: string | null;
  usageTokens?: number | null;
  outputDeltaBatches?: number | null;
}): number | null {
  const totalMs = input.totalMs ?? 0;
  const ttftMs = input.ttftMs;
  if (ttftMs == null || !Number.isFinite(ttftMs) || ttftMs < 0) return null;
  if (!totalMs || totalMs <= 0) return null;
  const decodeMs = totalMs - ttftMs;
  if (!(decodeMs > 0)) return null;
  if (isSingleBurstOutput(input.outputDeltaBatches)) return null;
  if (decodeMs < MIN_DECODE_WINDOW_MS) return null;
  const at = effectiveOutputTokens(input.outputText ?? "", input.usageTokens);
  if (at <= 1) return null;
  return (at - 1) / (decodeMs / 1000);
}

/**
 * 프리필 TPS — `prompt_tokens / (ttft_ms / 1000)`.
 * `promptTokens`가 없으면 근사하지 않고 null (구 런·usage 미보고).
 * 첫 출력이 도구 호출이고 출력 전체가 한 배치로 왔으면 null — TTFT에 호출 전체의 생성 시간이
 * 들어가 프리필이 과소평가된다(인자를 스트리밍하지 않는 백엔드, 예: Apple Foundation Models).
 */
export function prefillTokensPerSecondFromRun(
  ttftMs: number | null | undefined,
  promptTokens: number | null | undefined,
  burst?: OutputBurstInput,
): number | null {
  if (ttftMs == null || !Number.isFinite(ttftMs) || ttftMs <= 0) return null;
  if (promptTokens == null || !Number.isFinite(promptTokens) || promptTokens <= 0) return null;
  if (burst?.firstOutputKind === "tool_call" && isSingleBurstOutput(burst.outputDeltaBatches)) {
    return null;
  }
  return promptTokens / (ttftMs / 1000);
}

/** 배치 수가 기록된 런에서만 판정한다. 부재(구 런)는 false — 호출부가 decode_ms 하한으로 대신 거른다. */
function isSingleBurstOutput(outputDeltaBatches: number | null | undefined): boolean {
  return (
    typeof outputDeltaBatches === "number" &&
    Number.isFinite(outputDeltaBatches) &&
    outputDeltaBatches <= 1
  );
}

/** 표·차트 표시용 소수 1자리. 비양수/비유한은 null. */
export function roundTpsDisplay(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10) / 10;
}
