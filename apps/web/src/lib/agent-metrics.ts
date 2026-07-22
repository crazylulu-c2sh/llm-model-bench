// #105: 에이전트 능력 지표 계산 코어는 @llm-bench/shared(agentMetricsFromRows 등). 여기엔 표 정렬 헬퍼 + 표시 메타.
import { compareModelIdAlphanumeric, compareStringsPinned, type ModelRouteAgentMetrics } from "@llm-bench/shared";

export {
  agentMetricsFromRows,
  type ModelRouteAgentMetrics,
  type AgentMetrics,
  type AgentResultRow,
} from "@llm-bench/shared";

/** 정렬 가능한 에이전트 지표 필드. */
export type AgentMetric =
  | "task_completion_rate"
  | "stall_rate"
  | "budget_exhausted_rate"
  | "thinking_budget_rate"
  | "task_ms_median"
  | "turns_median"
  | "valid_tool_call_rate_mean"
  | "tool_arg_fidelity"
  | "arg_attempt_rate"
  | "output_efficiency"
  | "quality_mean"
  | "workflow_adherence_mean"
  | "tool_call_excess_mean";

export type SortDir = "asc" | "desc";
export type AgentSortKey = { kind: "model" } | { kind: "route" } | { kind: "metric"; metric: AgentMetric };
export type AgentSort = { key: AgentSortKey; dir: SortDir };

/** 지표 표시 방향: higher=클수록 좋음(내림 기본), lower=작을수록 좋음(오름 기본). */
export type MetricDir = "higher" | "lower";
/** 표시 형식: 비율(%)·정수 ms·소수 턴. */
export type MetricFormat = "pct" | "ms" | "num";

export type AgentMetricMeta = {
  metric: AgentMetric;
  label: string;
  title: string;
  dir: MetricDir;
  format: MetricFormat;
};

/** 표 컬럼 순서·라벨·방향·형식. */
export const AGENT_METRIC_COLUMNS: readonly AgentMetricMeta[] = [
  { metric: "task_completion_rate", label: "완료율", title: "completed / 전체 agent 런 — 높을수록 좋음", dir: "higher", format: "pct" },
  { metric: "stall_rate", label: "정체율", title: "stall / 전체 — 빈 턴 정체 비율(낮을수록 좋음)", dir: "lower", format: "pct" },
  { metric: "budget_exhausted_rate", label: "예산소진율", title: "budget_exhausted / 전체 — maxTurns 소진 비율(낮을수록 좋음)", dir: "lower", format: "pct" },
  { metric: "thinking_budget_rate", label: "사고예산소진", title: "thinking_exhausted_budget=true 비율 — 사고로 per-turn 예산을 소진(낮을수록 좋음)", dir: "lower", format: "pct" },
  { metric: "task_ms_median", label: "과업ms", title: "완료 런의 total_ms 중앙값 — 완료 과업당 벽시계(낮을수록 좋음)", dir: "lower", format: "ms" },
  { metric: "turns_median", label: "턴", title: "완료 런의 turns_to_completion 중앙값", dir: "lower", format: "num" },
  { metric: "valid_tool_call_rate_mean", label: "유효호출률", title: "유효 tool_call 턴 비율 평균. 분모에 최종 무도구 턴 포함 → k턴이면 k/(k+1)(높을수록 좋음)", dir: "higher", format: "pct" },
  { metric: "tool_arg_fidelity", label: "인자충실도", title: "Σtool_arg_hits / Σattempts — 불투명 id를 정확히 복사한 비율(높을수록 좋음). argDispatch 시나리오만", dir: "higher", format: "pct" },
  { metric: "arg_attempt_rate", label: "인자시도율", title: "attempts>0 런 비율 — 낮으면 복잡한 id를 보고 호출 자체를 포기(충실도와 함께 읽을 것)", dir: "higher", format: "pct" },
  { metric: "output_efficiency", label: "출력효율", title: "Σ최종턴 토큰 / Σ전 턴 usage 토큰 — 중간 턴 사고 낭비의 역수(높을수록 좋음)", dir: "higher", format: "pct" },
  { metric: "quality_mean", label: "품질(rubric)", title: "결정론 rubric 평균 — **0~1 스케일**(다른 비율 지표와 의미가 다름). 스코어보드 메인 품질은 라우트를 풀링하므로 여기서 라우트별 발산을 본다", dir: "higher", format: "pct" },
  { metric: "workflow_adherence_mean", label: "워크플로", title: "시나리오가 지시한 도구 중 실제로 부른 비율 — **점수에 반영되지 않는다**(적게 쓰고 정답이면 효율). 순위 해석용 진단 지표", dir: "higher", format: "pct" },
  { metric: "tool_call_excess_mean", label: "도구초과", title: "도구 초과 호출 비율 max(0, 실제/기대−1) — 0=낭비 없음, >0=남용(예: 같은 도구를 반복 호출하다 예산 소진). 적게 부른 것은 0 이고 '워크플로' 컬럼이 따로 잰다. error_v1 의 기대치는 재시도를 포함하므로 이 지표는 재시도 실패를 잡지 않는다(품질 rubric 의 몫)", dir: "lower", format: "pct" },
];

/** 기본 정렬 = 완료율 내림차순. */
export const DEFAULT_AGENT_SORT: AgentSort = {
  key: { kind: "metric", metric: "task_completion_rate" },
  dir: "desc",
};

export function sameAgentSortKey(a: AgentSortKey, b: AgentSortKey): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "metric" && b.kind === "metric") return a.metric === b.metric;
  return true;
}

const COL_BY_METRIC = new Map(AGENT_METRIC_COLUMNS.map((c) => [c.metric, c]));

/** 새 컬럼을 고를 때 기본 방향: higher→desc, lower→asc, 모델/라우트→asc. */
export function naturalAgentDir(key: AgentSortKey): SortDir {
  if (key.kind !== "metric") return "asc";
  return COL_BY_METRIC.get(key.metric)?.dir === "higher" ? "desc" : "asc";
}

export function agentMetricValue(row: ModelRouteAgentMetrics, metric: AgentMetric): number | null {
  return row[metric];
}

function cmpNullableDir(a: number | null, b: number | null, dir: SortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // null은 방향 무관 맨 아래
  if (b == null) return -1;
  return dir === "asc" ? a - b : b - a;
}

export function compareAgentRows(a: ModelRouteAgentMetrics, b: ModelRouteAgentMetrics, sort: AgentSort): number {
  if (sort.key.kind === "model") {
    const c = compareModelIdAlphanumeric(a.model_id, b.model_id);
    return sort.dir === "asc" ? c : -c;
  }
  if (sort.key.kind === "route") {
    const c = compareStringsPinned(a.api_route, b.api_route);
    return (sort.dir === "asc" ? c : -c) || compareModelIdAlphanumeric(a.model_id, b.model_id);
  }
  const primary = cmpNullableDir(
    agentMetricValue(a, sort.key.metric),
    agentMetricValue(b, sort.key.metric),
    sort.dir,
  );
  return primary || compareModelIdAlphanumeric(a.model_id, b.model_id) || compareStringsPinned(a.api_route, b.api_route);
}

/** rows를 sort 기준으로 정렬한 새 배열(입력 비파괴). */
export function sortAgentMetrics(
  rows: readonly ModelRouteAgentMetrics[],
  sort: AgentSort,
): ModelRouteAgentMetrics[] {
  return [...rows].sort((a, b) => compareAgentRows(a, b, sort));
}
