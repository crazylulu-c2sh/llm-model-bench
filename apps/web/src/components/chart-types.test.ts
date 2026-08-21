import { describe, expect, it } from "vitest";
import {
  apiRouteRank,
  compareScenarioExecutionOrder,
  comparePivotToFlatBarData,
  pivotCompareSeries,
  sortChartRowsForBarOrder,
  type ChartRow,
  type CompareSeries,
} from "./chart-types";

function row(scenario: string, api: string, modelId?: string): ChartRow {
  return {
    id: `${modelId ?? ""}|${scenario}|${api}`,
    labelShort: scenario,
    fullLabel: scenario,
    scenario,
    api,
    ttft: 1,
    tps: 1,
    modelId,
  };
}

describe("compareScenarioExecutionOrder", () => {
  it("realOrder 인자를 생략하면 정적 카탈로그 순서로 동작(하위 호환)", () => {
    expect(compareScenarioExecutionOrder("chat_hello", "code_sort_js")).toBeLessThan(0);
  });

  it("realOrder를 전달하면 실제 실행 순서를 우선한다", () => {
    const realOrder = ["code_sort_js", "chat_hello"];
    expect(compareScenarioExecutionOrder("code_sort_js", "chat_hello", realOrder)).toBeLessThan(0);
  });
});

describe("sortChartRowsForBarOrder", () => {
  it("realOrder 없으면 정적 카탈로그 순서", () => {
    const rows = [row("code_sort_js", "chat_completions"), row("chat_hello", "chat_completions")];
    const sorted = sortChartRowsForBarOrder(rows);
    expect(sorted.map((r) => r.scenario)).toEqual(["chat_hello", "code_sort_js"]);
  });

  it("realOrder 있으면 실제 실행 순서를 따른다", () => {
    const rows = [row("chat_hello", "chat_completions"), row("code_sort_js", "chat_completions")];
    const sorted = sortChartRowsForBarOrder(rows, ["code_sort_js", "chat_hello"]);
    expect(sorted.map((r) => r.scenario)).toEqual(["code_sort_js", "chat_hello"]);
  });

  it("agent_* 등 정적 카탈로그에 없는 시나리오끼리는 realOrder 없이도 이름순으로 결정적 정렬", () => {
    const rows = [row("agent_loop_zeta", "chat_completions"), row("agent_loop_alpha", "chat_completions")];
    const sorted = sortChartRowsForBarOrder(rows);
    expect(sorted.map((r) => r.scenario)).toEqual(["agent_loop_alpha", "agent_loop_zeta"]);
  });
});

describe("pivotCompareSeries", () => {
  const series: CompareSeries[] = [
    {
      modelId: "m1",
      label: "m1",
      rows: [row("code_sort_js", "chat_completions", "m1"), row("chat_hello", "chat_completions", "m1")],
    },
  ];

  it("realOrder 없으면 정적 카탈로그 순서", () => {
    const pivoted = pivotCompareSeries(series);
    expect(pivoted.map((p) => p.scenario)).toEqual(["chat_hello", "code_sort_js"]);
  });

  it("realOrder 있으면 실제 실행 순서를 따른다", () => {
    const pivoted = pivotCompareSeries(series, ["code_sort_js", "chat_hello"]);
    expect(pivoted.map((p) => p.scenario)).toEqual(["code_sort_js", "chat_hello"]);
  });
});

describe("comparePivotToFlatBarData", () => {
  const series: CompareSeries[] = [
    {
      modelId: "m1",
      label: "m1",
      rows: [row("code_sort_js", "chat_completions", "m1"), row("chat_hello", "chat_completions", "m1")],
    },
  ];

  it("realOrder 있으면 flat bar 데이터도 실제 실행 순서를 따른다", () => {
    const realOrder = ["code_sort_js", "chat_hello"];
    const pivoted = pivotCompareSeries(series, realOrder);
    const flat = comparePivotToFlatBarData(pivoted, series, "fallback", realOrder);
    expect(flat.map((r) => r.scenario)).toEqual(["code_sort_js", "chat_hello"]);
  });
});

describe("apiRouteRank", () => {
  it("chat_completions → messages → 기타 순", () => {
    expect(apiRouteRank("chat_completions")).toBeLessThan(apiRouteRank("messages"));
    expect(apiRouteRank("messages")).toBeLessThan(apiRouteRank("something_else"));
  });
});
