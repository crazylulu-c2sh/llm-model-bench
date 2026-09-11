import type { SortingState } from "@tanstack/react-table";
import type { Messages } from "../i18n";
import { cycleColumnSort as cycleColumnSortBase, isSameSorting } from "./column-sort-cycle";

/** 벤치 실행 순서: 모델 큐 → 시나리오(+API는 시나리오 열 sortingFn에 합침) */
export const BENCH_EXECUTION_SORT: SortingState = [
  { id: "model_id", desc: false },
  { id: "scenario", desc: false },
];

/** ResultsTable에서 내림차순을 먼저 쓰는 열(높을수록 좋음·완료 시각 등). */
export const RESULTS_FIRST_DESC_IDS = new Set([
  "tps",
  "output_tokens",
  "quality",
  "agent",
]);

export function isBenchExecutionSort(sorting: SortingState): boolean {
  return isSameSorting(sorting, BENCH_EXECUTION_SORT);
}

/** 헤더 클릭: default → firstDir → opposite → default */
export function cycleColumnSort(columnId: string, sorting: SortingState): SortingState {
  return cycleColumnSortBase(
    columnId,
    sorting,
    BENCH_EXECUTION_SORT,
    RESULTS_FIRST_DESC_IDS.has(columnId),
  );
}

// 정렬 라벨·문구는 i18n 카탈로그(m.results.sort)로 이전. 순수 헬퍼라 서브레코드를 파라미터로 받는다.
export function resultsSortLine(sorting: SortingState, sort: Messages["results"]["sort"]): string {
  if (isBenchExecutionSort(sorting)) return sort.current + sort.benchOrder;
  if (sorting.length === 0) return sort.current + sort.none;
  const dirOf = (desc: boolean) => (desc ? sort.desc : sort.asc);
  const columns = sort.columns as Record<string, string>;
  const label = (id: string) => columns[id] ?? id;
  const allSameDir = sorting.every((s) => s.desc === sorting[0]!.desc);
  if (allSameDir) {
    const chain = sorting.map((s) => label(s.id)).join(" → ");
    return `${sort.current}${chain} · ${dirOf(sorting[0]!.desc)}`;
  }
  const chain = sorting.map((s) => `${label(s.id)}(${dirOf(s.desc)})`).join(" → ");
  return `${sort.current}${chain}`;
}
