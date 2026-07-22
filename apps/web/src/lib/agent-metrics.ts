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
  dir: MetricDir;
  format: MetricFormat;
};

/** 표 컬럼 순서·방향·형식. 라벨/설명(title)은 i18n 카탈로그(m.monitor.agentMetric*)에서 metric 키로 조회. */
export const AGENT_METRIC_COLUMNS: readonly AgentMetricMeta[] = [
  { metric: "task_completion_rate", dir: "higher", format: "pct" },
  { metric: "stall_rate", dir: "lower", format: "pct" },
  { metric: "budget_exhausted_rate", dir: "lower", format: "pct" },
  { metric: "thinking_budget_rate", dir: "lower", format: "pct" },
  { metric: "task_ms_median", dir: "lower", format: "ms" },
  { metric: "turns_median", dir: "lower", format: "num" },
  { metric: "valid_tool_call_rate_mean", dir: "higher", format: "pct" },
  { metric: "tool_arg_fidelity", dir: "higher", format: "pct" },
  { metric: "arg_attempt_rate", dir: "higher", format: "pct" },
  { metric: "output_efficiency", dir: "higher", format: "pct" },
  { metric: "quality_mean", dir: "higher", format: "pct" },
  { metric: "workflow_adherence_mean", dir: "higher", format: "pct" },
  { metric: "tool_call_excess_mean", dir: "lower", format: "pct" },
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
