import type { SortingState } from "@tanstack/react-table";

/** 헤더 클릭 3단: default → firstDir → opposite → default. */
export function cycleColumnSort(
  columnId: string,
  sorting: SortingState,
  defaultSort: SortingState,
  firstDesc = false,
): SortingState {
  if (isSameSorting(sorting, defaultSort)) {
    // firstDir가 기본과 같으면(예: id asc 기본 + firstDesc=false) 반대 방향으로 건너뛴다.
    if (
      defaultSort.length === 1 &&
      defaultSort[0]!.id === columnId &&
      defaultSort[0]!.desc === firstDesc
    ) {
      return [{ id: columnId, desc: !firstDesc }];
    }
    return [{ id: columnId, desc: firstDesc }];
  }
  if (sorting.length === 1 && sorting[0]!.id === columnId) {
    if (sorting[0]!.desc === firstDesc) {
      return [{ id: columnId, desc: !firstDesc }];
    }
    return [...defaultSort];
  }
  return [{ id: columnId, desc: firstDesc }];
}

export function isSameSorting(a: SortingState, b: SortingState): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.id === b[i]!.id && s.desc === b[i]!.desc);
}

/**
 * Scoreboard / Agent / Leak 등 {key,dir} 정렬의 3단 사이클.
 * 기본 → naturalDir(first) → 반대 → 기본.
 * 기본 키가 first와 같은 dir면 첫 클릭은 반대로 건너뛴다.
 */
export function cycleKeyedSort<K>(
  prev: { key: K; dir: "asc" | "desc" },
  nextKey: K,
  defaultSort: { key: K; dir: "asc" | "desc" },
  naturalDir: (key: K) => "asc" | "desc",
  sameKey: (a: K, b: K) => boolean,
): { key: K; dir: "asc" | "desc" } {
  const isDefault =
    sameKey(prev.key, defaultSort.key) && prev.dir === defaultSort.dir;

  if (!sameKey(prev.key, nextKey)) {
    const first = naturalDir(nextKey);
    // 기본 상태에서 기본 키를 다시 고른 경우는 sameKey가 true라 여기 안 옴.
    return { key: nextKey, dir: first };
  }

  // 같은 키
  const first = naturalDir(nextKey);
  if (isDefault || prev.dir === first) {
    // 기본이거나 firstDir면 → 반대
    const flipped: "asc" | "desc" = first === "asc" ? "desc" : "asc";
    // 반대가 곧 기본이면(기본 키+dir=first인 경우 flipped≠default) 그냥 flipped
    return { key: nextKey, dir: flipped };
  }
  // 반대 방향 → 기본 복귀
  return { key: defaultSort.key, dir: defaultSort.dir };
}
