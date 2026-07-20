import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_SORT,
  agentMetricValue,
  naturalAgentDir,
  sameAgentSortKey,
  sortAgentMetrics,
  type ModelRouteAgentMetrics,
} from "./agent-metrics";

function mrow(p: Partial<ModelRouteAgentMetrics> & { model_id: string }): ModelRouteAgentMetrics {
  return {
    api_route: "chat_completions",
    n: 1,
    task_completion_rate: 0,
    stall_rate: 0,
    budget_exhausted_rate: 0,
    thinking_budget_rate: 0,
    task_ms_median: null,
    turns_median: null,
    valid_tool_call_rate_mean: null,
    tool_arg_fidelity: null,
    arg_attempt_rate: null,
    output_efficiency: null,
    quality_mean: null,
    workflow_adherence_mean: null,
    tool_call_excess_mean: null,
    ...p,
  };
}

describe("agent-metrics sort helpers", () => {
  it("기본 정렬 = 완료율 내림차순, null은 맨 아래", () => {
    const rows = [
      mrow({ model_id: "low", task_completion_rate: 0.2 }),
      mrow({ model_id: "high", task_completion_rate: 0.9 }),
      mrow({ model_id: "mid", task_completion_rate: 0.5 }),
    ];
    const sorted = sortAgentMetrics(rows, DEFAULT_AGENT_SORT);
    expect(sorted.map((r) => r.model_id)).toEqual(["high", "mid", "low"]);
  });

  it("naturalAgentDir: higher 지표는 desc, lower 지표는 asc", () => {
    expect(naturalAgentDir({ kind: "metric", metric: "task_completion_rate" })).toBe("desc");
    expect(naturalAgentDir({ kind: "metric", metric: "stall_rate" })).toBe("asc");
    expect(naturalAgentDir({ kind: "metric", metric: "output_efficiency" })).toBe("desc");
    expect(naturalAgentDir({ kind: "model" })).toBe("asc");
  });

  it("stall_rate asc 정렬(낮을수록 좋음)", () => {
    const rows = [
      mrow({ model_id: "b", stall_rate: 0.8 }),
      mrow({ model_id: "a", stall_rate: 0.1 }),
    ];
    const sorted = sortAgentMetrics(rows, { key: { kind: "metric", metric: "stall_rate" }, dir: "asc" });
    expect(sorted.map((r) => r.model_id)).toEqual(["a", "b"]);
  });

  it("agentMetricValue·sameAgentSortKey", () => {
    const row = mrow({ model_id: "x", tool_arg_fidelity: 0.75 });
    expect(agentMetricValue(row, "tool_arg_fidelity")).toBe(0.75);
    expect(sameAgentSortKey({ kind: "metric", metric: "stall_rate" }, { kind: "metric", metric: "stall_rate" })).toBe(true);
    expect(sameAgentSortKey({ kind: "metric", metric: "stall_rate" }, { kind: "metric", metric: "turns_median" })).toBe(false);
    expect(sameAgentSortKey({ kind: "model" }, { kind: "route" })).toBe(false);
  });
});
