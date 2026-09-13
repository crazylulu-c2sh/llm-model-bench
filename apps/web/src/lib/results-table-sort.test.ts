import { describe, expect, it } from "vitest";
import { cycleColumnSort, cycleKeyedSort, isSameSorting } from "./column-sort-cycle";
import {
  BENCH_EXECUTION_SORT,
  cycleColumnSort as cycleResultsSort,
  isBenchExecutionSort,
  resultsSortLine,
} from "./results-table-sort";
import { ko } from "../i18n/messages/ko";

describe("cycleColumnSort", () => {
  const def = [{ id: "model_id", desc: false }];

  it("default → firstDesc → opposite → default (내림 우선)", () => {
    let s = [...def];
    s = cycleColumnSort("finished_at", s, def, true);
    expect(s).toEqual([{ id: "finished_at", desc: true }]);
    s = cycleColumnSort("finished_at", s, def, true);
    expect(s).toEqual([{ id: "finished_at", desc: false }]);
    s = cycleColumnSort("finished_at", s, def, true);
    expect(s).toEqual(def);
  });

  it("기본 열을 다시 클릭하면 firstDir가 기본과 같아 반대로 건너뛴다", () => {
    let s = [...def];
    s = cycleColumnSort("model_id", s, def, false);
    expect(s).toEqual([{ id: "model_id", desc: true }]);
    s = cycleColumnSort("model_id", s, def, false);
    expect(s).toEqual(def);
  });
});

describe("cycleKeyedSort", () => {
  type Key = { kind: "a" } | { kind: "b" };
  type Sort = { key: Key; dir: "asc" | "desc" };
  const def: Sort = { key: { kind: "a" }, dir: "desc" };
  const same = (a: Key, b: Key) => a.kind === b.kind;
  const natural = (k: Key): "asc" | "desc" => (k.kind === "a" ? "desc" : "asc");

  it("기본 → 반대 → 기본 (기본 키)", () => {
    let s: Sort = { ...def };
    s = cycleKeyedSort(s, { kind: "a" }, def, natural, same);
    expect(s).toEqual({ key: { kind: "a" }, dir: "asc" });
    s = cycleKeyedSort(s, { kind: "a" }, def, natural, same);
    expect(s).toEqual(def);
  });

  it("새 키 → first → opposite → 기본", () => {
    let s: Sort = { ...def };
    s = cycleKeyedSort(s, { kind: "b" }, def, natural, same);
    expect(s).toEqual({ key: { kind: "b" }, dir: "asc" });
    s = cycleKeyedSort(s, { kind: "b" }, def, natural, same);
    expect(s).toEqual({ key: { kind: "b" }, dir: "desc" });
    s = cycleKeyedSort(s, { kind: "b" }, def, natural, same);
    expect(s).toEqual(def);
  });
});

describe("isSameSorting", () => {
  it("동일하면 true", () => {
    expect(isSameSorting(BENCH_EXECUTION_SORT, [...BENCH_EXECUTION_SORT])).toBe(true);
  });
});

describe("results cycleColumnSort", () => {
  it("default → asc → desc → default (오름 우선 열)", () => {
    let s = BENCH_EXECUTION_SORT;
    s = cycleResultsSort("reasoning_effort", s);
    expect(s).toEqual([{ id: "reasoning_effort", desc: false }]);
    s = cycleResultsSort("reasoning_effort", s);
    expect(s).toEqual([{ id: "reasoning_effort", desc: true }]);
    s = cycleResultsSort("reasoning_effort", s);
    expect(s).toEqual(BENCH_EXECUTION_SORT);
  });

  it("tps는 내림 우선", () => {
    let s = BENCH_EXECUTION_SORT;
    s = cycleResultsSort("tps", s);
    expect(s).toEqual([{ id: "tps", desc: true }]);
    s = cycleResultsSort("tps", s);
    expect(s).toEqual([{ id: "tps", desc: false }]);
    s = cycleResultsSort("tps", s);
    expect(s).toEqual(BENCH_EXECUTION_SORT);
  });
});

describe("isBenchExecutionSort / resultsSortLine", () => {
  it("기본 2열 asc와 일치하면 true", () => {
    expect(isBenchExecutionSort(BENCH_EXECUTION_SORT)).toBe(true);
  });

  it("기본 정렬이면 벤치 실행 순서 문구", () => {
    expect(resultsSortLine(BENCH_EXECUTION_SORT, ko.results.sort)).toBe("현재 정렬: 벤치 실행 순서");
  });
});
