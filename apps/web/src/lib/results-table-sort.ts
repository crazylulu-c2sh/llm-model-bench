import type { SortingState } from "@tanstack/react-table";

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

const RESULT_SORT_LABELS: Record<string, string> = {
  model_id: "모델",
  scenario: "시나리오",
  api: "API",
  ttft_ms: "TTFT (ms)",
  tps: "TPS (tok/s)",
};

export function resultsSortLine(sorting: SortingState): string {
  if (isBenchExecutionSort(sorting)) return "현재 정렬: 벤치 실행 순서";
  if (sorting.length === 0) return "현재 정렬: 없음";
  const dirOf = (desc: boolean) => (desc ? "내림차순" : "오름차순");
  const allSameDir = sorting.every((s) => s.desc === sorting[0]!.desc);
  if (allSameDir) {
    const chain = sorting.map((s) => RESULT_SORT_LABELS[s.id] ?? s.id).join(" → ");
    return `현재 정렬: ${chain} · ${dirOf(sorting[0]!.desc)}`;
  }
  const chain = sorting
    .map((s) => `${RESULT_SORT_LABELS[s.id] ?? s.id}(${dirOf(s.desc)})`)
    .join(" → ");
  return `현재 정렬: ${chain}`;
}
