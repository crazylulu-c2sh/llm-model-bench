import { isAgentScenario } from "../scenarios-preview";

/**
 * #105: 멀티턴 에이전트 능력 지표(모델 × api_route 슬라이스).
 *
 * leak-metrics 와 같은 구조(서버·웹 두 진입점, 라우트 분리)지만 대상이 다르다 — agent_* 시나리오의
 * 완료된 agent_loop 런만 집계한다. 이 지표가 "raw TPS 역전"을 드러낸다: 과사고 모델은 speed 그룹
 * tps 는 높아도 task_completion_rate 가 낮고 thinking_budget_rate·정체가 높으며 output_efficiency 가
 * 낮다. 절제 모델은 반대. 완료 과업당 벽시계(task_ms)·턴수도 완료 런 기준으로만 잰다.
 */

/** per-run 에이전트 신호(agent-loop 하네스가 저장). 대부분 선택(레거시 런엔 없을 수 있음). */
export type AgentRunInput = {
  agent_completion_reason?: "completed" | "stall" | "budget_exhausted" | null;
  total_ms?: number | null;
  turns_to_completion?: number | null;
  valid_tool_call_rate?: number | null;
  thinking_exhausted_budget?: boolean | null;
  /** #105: argDispatch 도구가 있을 때만 존재(없으면 undefined = 측정 대상 아님/레거시). */
  tool_arg_hits?: number | null;
  tool_arg_attempts?: number | null;
  /** #105: 최종(무도구) 턴 출력 토큰(효율 분자). */
  final_turn_output_tokens?: number | null;
  usage_output_tokens?: number | null;
};

/** 한 (model, api_route) 슬라이스의 에이전트 지표. */
export type AgentMetrics = {
  /** 대상(agent 시나리오 + completion_reason 존재) 런 수. */
  n: number;
  /** completed / n (정체·예산소진 포함 전체 분모). */
  task_completion_rate: number;
  stall_rate: number;
  budget_exhausted_rate: number;
  /** thinking_exhausted_budget=true / n. */
  thinking_budget_rate: number;
  /** 완료 런의 total_ms 중앙값(ms). 완료 0건이면 null. */
  task_ms_median: number | null;
  /** 완료 런의 turns_to_completion 중앙값. 완료 0건이면 null. */
  turns_median: number | null;
  /** per-run valid_tool_call_rate 산술평균. 값 없으면 null. */
  valid_tool_call_rate_mean: number | null;
  /** Σtool_arg_hits / Σtool_arg_attempts. Σattempts=0 또는 카운터 부재면 null. */
  tool_arg_fidelity: number | null;
  /** attempts>0 런 / 카운터 존재 런 (호출 자체를 포기했는지 분리). 카운터 부재면 null. */
  arg_attempt_rate: number | null;
  /** Σfinal_turn_output_tokens / Σusage_output_tokens (완료+양쪽 존재+usage>0, 0..1 clamp). 대상 0건이면 null. */
  output_efficiency: number | null;
};

/** model × route 키가 붙은 에이전트 지표 행. */
export type ModelRouteAgentMetrics = AgentMetrics & {
  model_id: string;
  api_route: string;
};

/** 서버 BenchResultDetail의 구조적 최소 입력(leak-metrics 와 동형). */
export type AgentBenchDetailInput = {
  meta: { model_id: string };
  scenarios: ReadonlyArray<{ id: string; api_route: string; runs: readonly AgentRunInput[] }>;
};

/** 웹 진입점용 최소 행 형태(`ScoringResultRow`의 부분집합 + scenario). */
export type AgentResultRow = { model_id: string; api: string; rowKey: string; scenario: string };

function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** 정렬 후 중앙값(짝수 개수는 두 중앙의 평균). 빈 배열 → null. */
function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

type AgentAccum = {
  n: number;
  completed: number;
  stall: number;
  budget: number;
  thinkingBudget: number;
  completedMs: number[];
  completedTurns: number[];
  validRates: number[];
  argHitsSum: number;
  argAttemptsSum: number;
  argRunsWithCounter: number;
  argRunsAttempted: number;
  effFinalSum: number;
  effUsageSum: number;
  effRuns: number;
};

function emptyAccum(): AgentAccum {
  return {
    n: 0,
    completed: 0,
    stall: 0,
    budget: 0,
    thinkingBudget: 0,
    completedMs: [],
    completedTurns: [],
    validRates: [],
    argHitsSum: 0,
    argAttemptsSum: 0,
    argRunsWithCounter: 0,
    argRunsAttempted: 0,
    effFinalSum: 0,
    effUsageSum: 0,
    effRuns: 0,
  };
}

const KEY_SEP = " ";

function accumulate(
  slices: Iterable<{ model_id: string; api_route: string; scenario: string; runs: readonly AgentRunInput[] }>,
): ModelRouteAgentMetrics[] {
  const order: string[] = [];
  const byKey = new Map<string, { model_id: string; api_route: string; acc: AgentAccum }>();

  for (const slice of slices) {
    if (!isAgentScenario(slice.scenario)) continue;
    if (!slice.runs || slice.runs.length === 0) continue;
    const key = `${slice.model_id}${KEY_SEP}${slice.api_route}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { model_id: slice.model_id, api_route: slice.api_route, acc: emptyAccum() };
      byKey.set(key, entry);
      order.push(key);
    }
    const acc = entry.acc;
    for (const run of slice.runs) {
      // 완료 사유가 없으면 malformed/부분 저장 — 제외.
      if (run.agent_completion_reason == null) continue;
      acc.n += 1;
      const completed = run.agent_completion_reason === "completed";
      if (completed) acc.completed += 1;
      else if (run.agent_completion_reason === "stall") acc.stall += 1;
      else if (run.agent_completion_reason === "budget_exhausted") acc.budget += 1;
      if (run.thinking_exhausted_budget === true) acc.thinkingBudget += 1;

      if (completed && isFiniteNum(run.total_ms)) acc.completedMs.push(run.total_ms);
      if (completed && isFiniteNum(run.turns_to_completion)) acc.completedTurns.push(run.turns_to_completion);
      if (isFiniteNum(run.valid_tool_call_rate)) acc.validRates.push(run.valid_tool_call_rate);

      // 인자 충실도: 카운터가 있는(argDispatch 시나리오) 런만.
      if (isFiniteNum(run.tool_arg_attempts)) {
        acc.argRunsWithCounter += 1;
        acc.argAttemptsSum += run.tool_arg_attempts;
        acc.argHitsSum += isFiniteNum(run.tool_arg_hits) ? run.tool_arg_hits : 0;
        if (run.tool_arg_attempts > 0) acc.argRunsAttempted += 1;
      }

      // 출력 효율: 완료 + 최종턴 토큰·usage 양쪽 존재 + usage>0.
      if (
        completed &&
        isFiniteNum(run.final_turn_output_tokens) &&
        isFiniteNum(run.usage_output_tokens) &&
        run.usage_output_tokens > 0
      ) {
        acc.effFinalSum += run.final_turn_output_tokens;
        acc.effUsageSum += run.usage_output_tokens;
        acc.effRuns += 1;
      }
    }
  }

  return order.map((key) => {
    const { model_id, api_route, acc } = byKey.get(key)!;
    const n = acc.n;
    return {
      model_id,
      api_route,
      n,
      task_completion_rate: n > 0 ? acc.completed / n : 0,
      stall_rate: n > 0 ? acc.stall / n : 0,
      budget_exhausted_rate: n > 0 ? acc.budget / n : 0,
      thinking_budget_rate: n > 0 ? acc.thinkingBudget / n : 0,
      task_ms_median: median(acc.completedMs),
      turns_median: median(acc.completedTurns),
      valid_tool_call_rate_mean:
        acc.validRates.length > 0 ? acc.validRates.reduce((a, b) => a + b, 0) / acc.validRates.length : null,
      tool_arg_fidelity: acc.argAttemptsSum > 0 ? acc.argHitsSum / acc.argAttemptsSum : null,
      arg_attempt_rate: acc.argRunsWithCounter > 0 ? acc.argRunsAttempted / acc.argRunsWithCounter : null,
      output_efficiency:
        acc.effRuns > 0 && acc.effUsageSum > 0
          ? Math.min(1, Math.max(0, acc.effFinalSum / acc.effUsageSum))
          : null,
    };
  });
}

/** 서버 경로: 저장된 벤치 상세들에서 (model, route)별 에이전트 지표. */
export function agentMetricsFromBenchDetails(
  details: readonly AgentBenchDetailInput[],
): ModelRouteAgentMetrics[] {
  function* slices() {
    for (const d of details) {
      for (const sc of d.scenarios) {
        yield { model_id: d.meta.model_id, api_route: sc.api_route, scenario: sc.id, runs: sc.runs };
      }
    }
  }
  return accumulate(slices());
}

/** 웹 경로: rows + detailAggregate에서 (model, route)별 에이전트 지표(서버와 동일 산식). */
export function agentMetricsFromRows(
  rows: readonly AgentResultRow[],
  detailAggregate: Record<string, { runs?: readonly AgentRunInput[] } | undefined>,
): ModelRouteAgentMetrics[] {
  function* slices() {
    for (const r of rows) {
      const runs = detailAggregate[r.rowKey]?.runs ?? [];
      yield { model_id: r.model_id, api_route: r.api, scenario: r.scenario, runs };
    }
  }
  return accumulate(slices());
}
