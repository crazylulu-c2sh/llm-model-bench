// #80: 누수/정체 지표 계산 코어는 @llm-bench/shared(leakMetricsFromRows 등). 여기엔 표 정렬 헬퍼만.
import { compareModelIdAlphanumeric, compareStringsPinned, type ModelRouteLeakMetrics } from "@llm-bench/shared";

export {
  AGENT_SAFE_THRESHOLDS,
  isAgentSafe,
  leakMetricsFromRows,
  type ModelRouteLeakMetrics,
  type LeakMetrics,
  type LeakResultRow,
} from "@llm-bench/shared";

/** 정렬 가능한 누수 지표(낮을수록 좋음). */
export type LeakMetric = "thinking_leak" | "empty_turn" | "channel_tag";
export type SortDir = "asc" | "desc";
export type LeakSortKey =
  | { kind: "model" }
  | { kind: "route" }
  | { kind: "metric"; metric: LeakMetric };
export type LeakSort = { key: LeakSortKey; dir: SortDir };

/** 기본 정렬 = thinking-leak 오름차순(낮을수록 agent-safe). */
export const DEFAULT_LEAK_SORT: LeakSort = {
  key: { kind: "metric", metric: "thinking_leak" },
  dir: "asc",
};

export function sameLeakSortKey(a: LeakSortKey, b: LeakSortKey): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "metric" && b.kind === "metric") return a.metric === b.metric;
  return true;
}

/** 새 컬럼을 고를 때 기본 방향: 지표는 asc(낮을수록 좋음), 모델/라우트도 asc. */
export function naturalLeakDir(_key: LeakSortKey): SortDir {
  return "asc";
}

/** 한 행에서 지표값을 뽑는다(정렬·표시 공유). */
export function leakMetricValue(row: ModelRouteLeakMetrics, metric: LeakMetric): number | null {
  if (metric === "thinking_leak") return row.thinking_leak_ratio;
  if (metric === "empty_turn") return row.empty_turn_rate;
  return row.channel_tag_leak;
}

function cmpNullableDir(a: number | null, b: number | null, dir: SortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // null은 방향과 무관하게 항상 맨 아래
  if (b == null) return -1;
  return dir === "asc" ? a - b : b - a;
}

export function compareLeakRows(a: ModelRouteLeakMetrics, b: ModelRouteLeakMetrics, sort: LeakSort): number {
  if (sort.key.kind === "model") {
    const c = compareModelIdAlphanumeric(a.model_id, b.model_id);
    return sort.dir === "asc" ? c : -c;
  }
  if (sort.key.kind === "route") {
    const c = compareStringsPinned(a.api_route, b.api_route);
    return (sort.dir === "asc" ? c : -c) || compareModelIdAlphanumeric(a.model_id, b.model_id);
  }
  const primary = cmpNullableDir(
    leakMetricValue(a, sort.key.metric),
    leakMetricValue(b, sort.key.metric),
    sort.dir,
  );
  return primary || compareModelIdAlphanumeric(a.model_id, b.model_id) || compareStringsPinned(a.api_route, b.api_route);
}

/** rows를 sort 기준으로 정렬한 새 배열(입력 비파괴). */
export function sortLeaks(rows: readonly ModelRouteLeakMetrics[], sort: LeakSort): ModelRouteLeakMetrics[] {
  return [...rows].sort((a, b) => compareLeakRows(a, b, sort));
}
