import { describe, expect, it } from "vitest";
import {
  BENCH_EXECUTION_SORT,
  cycleColumnSort,
  isBenchExecutionSort,
  resultsSortLine,
} from "./results-table-sort";

describe("isBenchExecutionSort", () => {
  it("기본 3열 asc와 일치하면 true", () => {
    expect(isBenchExecutionSort(BENCH_EXECUTION_SORT)).toBe(true);
    expect(isBenchExecutionSort([...BENCH_EXECUTION_SORT])).toBe(true);
  });

  it("단일 열 정렬이면 false", () => {
    expect(isBenchExecutionSort([{ id: "model_id", desc: false }])).toBe(false);
  });

  it("방향이 다르면 false", () => {
    expect(
      isBenchExecutionSort([
        { id: "model_id", desc: true },
        { id: "scenario", desc: false },
        { id: "api", desc: false },
      ]),
    ).toBe(false);
  });
});

describe("cycleColumnSort", () => {
  it("default → asc → desc → default", () => {
    let s = BENCH_EXECUTION_SORT;
    s = cycleColumnSort("ttft_ms", s);
    expect(s).toEqual([{ id: "ttft_ms", desc: false }]);
    s = cycleColumnSort("ttft_ms", s);
    expect(s).toEqual([{ id: "ttft_ms", desc: true }]);
    s = cycleColumnSort("ttft_ms", s);
    expect(s).toEqual(BENCH_EXECUTION_SORT);
  });

  it("다른 열 클릭 시 해당 열 asc부터 시작", () => {
    const s = cycleColumnSort("tps", [{ id: "model_id", desc: false }]);
    expect(s).toEqual([{ id: "tps", desc: false }]);
  });
});

describe("resultsSortLine", () => {
  it("기본 정렬이면 벤치 실행 순서 문구", () => {
    expect(resultsSortLine(BENCH_EXECUTION_SORT)).toBe("현재 정렬: 벤치 실행 순서");
  });

  it("단일 열 정렬이면 컬럼명·방향 표시", () => {
    expect(resultsSortLine([{ id: "ttft_ms", desc: true }])).toBe(
      "현재 정렬: TTFT (ms) · 내림차순",
    );
  });
});
