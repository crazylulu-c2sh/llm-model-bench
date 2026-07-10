// 스코어보드 계산 코어(품질·속도·랭킹)는 @llm-bench/shared로 이전됨(web·server·mcp 단일 소스).
// 아래 UI 전용 정렬 헬퍼(헤더 클릭 상호작용)만 web에 남는다.
import { compareModelIdAlphanumeric, type ScoreboardRow } from "@llm-bench/shared";

export {
  averageRunsToScoringRow,
  buildScoringRows,
  scoringRowsFromBenchDetails,
  computeScoreboard,
  scoreboardFromRows,
  type ScoringRunInput,
  type ScoringAggregate,
  type ScoringResultRow,
  type ScoringRow,
  type ScoreboardRow,
} from "@llm-bench/shared";

// ─── 사용자 정렬(헤더 클릭) ─────────────────────────────────────────────────
// computeScoreboard가 만든 board를 UI에서 단일 지표로 재정렬한다. 기본 정렬일 때는
// 컴포넌트가 재정렬을 생략하고 board를 그대로 써서 computeScoreboard의 2차 키(총합 속도)까지
// 보존한다(sortEquals + DEFAULT_SCOREBOARD_SORT). 따라서 여기 tie-break는 model_id만으로 충분.

/** 정렬 가능한 컬럼 그룹(텍스트/비전/총합). */
export type ScoreGroup = "text" | "vision" | "total";
/** 정렬 가능한 지표(품질/속도/지연). */
export type ScoreMetric = "quality" | "speed" | "latency";
export type SortDir = "asc" | "desc";
/** 정렬 키: 모델명 또는 (그룹×지표) 셀. */
export type ScoreboardSortKey =
  | { kind: "model" }
  | { kind: "metric"; group: ScoreGroup; metric: ScoreMetric };
export type ScoreboardSort = { key: ScoreboardSortKey; dir: SortDir };

/** 컴포넌트 초기 정렬 = 총합 품질 desc(= computeScoreboard 1차 키). */
export const DEFAULT_SCOREBOARD_SORT: ScoreboardSort = {
  key: { kind: "metric", group: "total", metric: "quality" },
  dir: "desc",
};

/** 정렬 키만 비교(헤더 활성 판정·클릭 토글용). */
export function sameSortKey(a: ScoreboardSortKey, b: ScoreboardSortKey): boolean {
  if (a.kind === "model" || b.kind === "model") return a.kind === b.kind;
  return a.group === b.group && a.metric === b.metric;
}

/** 키+방향 동시 비교(기본 정렬 short-circuit 판정용). */
export function sortEquals(a: ScoreboardSort, b: ScoreboardSort): boolean {
  return a.dir === b.dir && sameSortKey(a.key, b.key);
}

/** 컬럼을 새로 고를 때의 기본 방향: 품질·속도→desc(높을수록 좋음), 지연·모델→asc. */
export function naturalDir(key: ScoreboardSortKey): SortDir {
  if (key.kind === "model") return "asc";
  return key.metric === "latency" ? "asc" : "desc";
}

/** 방향 인지 숫자 비교 — null은 방향과 무관하게 항상 맨 아래. */
function cmpNullableDir(a: number | null, b: number | null, dir: SortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === "asc" ? a - b : b - a;
}

/** 한 행에서 (그룹×지표) 정렬값을 뽑는다. 정렬·차트가 동일 접근자를 공유한다. */
export function scoreboardMetricValue(
  row: ScoreboardRow,
  group: ScoreGroup,
  metric: ScoreMetric,
): number | null {
  if (metric === "quality") return row.quality[group].value;
  if (metric === "speed") return row.speed[group].tpsMedian; // 실제 디코드 tok/s 중앙값(정렬·차트 공용)
  return row.speed[group].ttftMs; // latency(낮을수록 좋음 — 방향은 naturalDir에서 asc)
}

/** 정렬 비교 — 단일 지표(또는 모델명) + model_id alphanumeric tie-break. */
export function compareScoreboardRows(
  a: ScoreboardRow,
  b: ScoreboardRow,
  sort: ScoreboardSort,
): number {
  if (sort.key.kind === "model") {
    const c = compareModelIdAlphanumeric(a.model_id, b.model_id);
    return sort.dir === "asc" ? c : -c;
  }
  const primary = cmpNullableDir(
    scoreboardMetricValue(a, sort.key.group, sort.key.metric),
    scoreboardMetricValue(b, sort.key.group, sort.key.metric),
    sort.dir,
  );
  return primary || compareModelIdAlphanumeric(a.model_id, b.model_id);
}

/** rows를 sort 기준으로 정렬한 새 배열(입력 비파괴). */
export function sortScoreboard(
  rows: readonly ScoreboardRow[],
  sort: ScoreboardSort,
): ScoreboardRow[] {
  return [...rows].sort((a, b) => compareScoreboardRows(a, b, sort));
}
