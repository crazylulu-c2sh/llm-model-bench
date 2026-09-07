/**
 * #174: 요청한 `max_tokens` 상한이 모델에 전달되지 않던 문제의 단일 해소 지점.
 *
 * 상한 소스가 넷이라 우선순위를 여기 한 곳에서만 정한다:
 *   1. `bench.max_tokens`   — 요청 레벨 명시값(API). **하드 상한**
 *   2. `profileMaxTokens`   — 프로필 패널 명시값(웹 UI가 보내는 것). 하드 상한
 *   3. 시나리오 `sampling.max_tokens` — 시나리오 작성자가 밝힌 의도
 *   4. max(vision floor, 프로필 권장값) — 아무 명시도 없을 때의 기본값
 *
 * 1·2는 사용자가 직접 쓴 숫자이므로 vision floor보다도 우선한다 — 상한이 너무 작아 잘리면
 * 기존 `truncated_at_max_tokens=N` 라벨이 붙으므로 조용히 부풀리는 것보다 낫다.
 *
 * 3이 4보다 위인 것은 agent 경로(`def.sampling?.max_tokens ?? args.maxTokens`)와 맞추기 위해서다.
 * 4의 `max()` 안에 넣으면 권장값이 더 클 때 시나리오 의도가 조용히 무시된다.
 */

export type MaxTokensSource =
  | "request"
  | "profile"
  | "scenario"
  | "vision"
  | "recommended";

export type ResolveMaxTokensInput = {
  /** `BenchRequest.max_tokens` (API 전용 필드). */
  requestMaxTokens?: number | null;
  /** `BenchRequest.profileMaxTokens` / `profile.maxTokensOverride`. */
  profileMaxTokens?: number | null;
  /** 시나리오 정의의 `sampling.max_tokens`. */
  scenarioMaxTokens?: number | null;
  /** vision 시나리오 기본 하한(`defaultMaxTokensForVisionScenario`). */
  visionFloor?: number | null;
  /** 프로필 권장값(`resolveBenchProfile().maxTokensRecommended`). */
  profileRecommended: number;
};

export type ResolvedMaxTokens = {
  value: number;
  source: MaxTokensSource;
};

/** 양의 정수만 유효한 값으로 본다. 0·음수·NaN·null은 "미지정"과 같게 취급. */
function positiveInt(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/**
 * 실효 `max_tokens`와 그 출처를 결정한다.
 * `source`는 `scenario_end`·런 메타에 실려 "요청 293인데 왜 1530이 나왔나"를 사후 대조하는 데 쓴다.
 */
export function resolveEffectiveMaxTokens(o: ResolveMaxTokensInput): ResolvedMaxTokens {
  const request = positiveInt(o.requestMaxTokens);
  if (request != null) return { value: request, source: "request" };

  const profile = positiveInt(o.profileMaxTokens);
  if (profile != null) return { value: profile, source: "profile" };

  // 시나리오가 스스로 밝힌 상한은 프로필 권장값보다 구체적이므로 그대로 존중한다(agent 경로와 동일).
  const scenario = positiveInt(o.scenarioMaxTokens);
  if (scenario != null) return { value: scenario, source: "scenario" };

  // 아무 명시도 없을 때만 기본값들의 최댓값. 동률이면 구체적인 쪽(vision > 권장값)이 이긴다.
  const candidates: ReadonlyArray<{ value: number | null; source: MaxTokensSource }> = [
    { value: positiveInt(o.visionFloor), source: "vision" },
    { value: positiveInt(o.profileRecommended), source: "recommended" },
  ];
  let best: ResolvedMaxTokens | null = null;
  for (const c of candidates) {
    if (c.value == null) continue;
    if (best == null || c.value > best.value) best = { value: c.value, source: c.source };
  }
  // 전부 미지정인 병리적 입력 — 상한 없이 흘려보내지 않도록 하네스 기본값으로 막는다.
  return best ?? { value: 512, source: "recommended" };
}
