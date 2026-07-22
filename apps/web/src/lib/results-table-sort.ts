import type { SortingState } from "@tanstack/react-table";
import type { Messages } from "../i18n";

/** 벤치 실행 순서: 모델 큐 → 시나리오 실행 인덱스 → API */
export const BENCH_EXECUTION_SORT: SortingState = [
  { id: "model_id", desc: false },
  { id: "scenario", desc: false },
  { id: "api", desc: false },
];

export function isBenchExecutionSort(sorting: SortingState): boolean {
  if (sorting.length !== BENCH_EXECUTION_SORT.length) return false;
  return BENCH_EXECUTION_SORT.every(
    (expected, i) => sorting[i]!.id === expected.id && sorting[i]!.desc === expected.desc,
  );
}

/** 헤더 클릭: default → asc → desc → default */
export function cycleColumnSort(columnId: string, sorting: SortingState): SortingState {
  if (isBenchExecutionSort(sorting)) {
    return [{ id: columnId, desc: false }];
  }
  if (sorting.length === 1 && sorting[0]!.id === columnId) {
    if (!sorting[0]!.desc) {
      return [{ id: columnId, desc: true }];
    }
    return [...BENCH_EXECUTION_SORT];
  }
  return [{ id: columnId, desc: false }];
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
