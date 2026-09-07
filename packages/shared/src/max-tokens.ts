/**
 * #174: 요청한 `max_tokens` 상한이 모델에 전달되지 않던 문제의 단일 해소 지점.
 *
 * 상한 소스가 넷이라 우선순위를 여기 한 곳에서만 정한다:
 *   1. `bench.max_tokens`   — 요청 레벨 명시값(API 전용). **하드 상한**
 *   2. 시나리오 `sampling.max_tokens` — 시나리오가 정의한 과업 제약
 *   3. `profileMaxTokens`   — 프로필 패널 명시값(웹 UI가 보내는 것)
 *   4. max(vision floor, 프로필 권장값) — 아무것도 없을 때의 기본값
 *
 * 1이 vision floor보다도 위인 것은, 상한이 너무 작아 잘리면 기존 `truncated_at_max_tokens=N`
 * 라벨이 붙기 때문이다 — 사용자가 쓴 숫자를 조용히 부풀리는 것보다 낫다.
 *
 * **2가 3보다 위인 것이 중요하다.** `profileMaxTokens`는 "일반 `max_tokens`와 분리해 시나리오별
 * 권장값과 충돌하지 않게" 만든 필드이고(`BenchRequest.profileMaxTokens` 주석), 웹 UI는 이것만
 * 보낸다. 이걸 시나리오 위에 두면 UI의 max_tokens 칸에 값을 넣는 것만으로 `agent_loop_*`의
 * per-turn 예산(192/512/640)이 전부 덮인다 — `agent_loop_budget_v1`은 그 192가 과업 자체다.
 * 2가 4보다 위인 것도 같은 이유이며, agent 경로의 기존 동작(`def.sampling ?? args.maxTokens`)과
 * 일치한다.
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

  // 시나리오가 정의한 제약은 프로필 패널 값·권장값보다 구체적이므로 그대로 존중한다
  // (agent per-turn 예산이 여기 해당한다 — UI 입력 하나로 덮이면 과업 자체가 바뀐다).
  const scenario = positiveInt(o.scenarioMaxTokens);
  if (scenario != null) return { value: scenario, source: "scenario" };

  const profile = positiveInt(o.profileMaxTokens);
  if (profile != null) return { value: profile, source: "profile" };

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
