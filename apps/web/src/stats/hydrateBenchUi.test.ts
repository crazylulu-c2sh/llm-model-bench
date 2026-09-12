import { describe, expect, it } from "vitest";
import type { BenchRunDetailResponse } from "../api-types";
import { mergeBenchDetailsToState } from "./hydrateBenchUi";

function detail(overrides: Partial<BenchRunDetailResponse["scenarios"][number]["runs"][number]> = {}): BenchRunDetailResponse {
  return {
    meta: {
      run_id: "run_1",
      base_url: "http://127.0.0.1:1234",
      provider: "lm_studio",
      model_id: "qwen/qwen3.8-27b",
      created_at: "2026-09-01T00:00:00.000Z",
    },
    scenarios: [
      {
        id: "chat_ping",
        api_route: "chat_completions",
        prompt_system_preview: null,
        prompt_preview: null,
        runs: [
          {
            ttft_ms: 10,
            total_ms: 100,
            output_text: "hi",
            stream_completed: true,
            usage_output_tokens: 7,
            ...overrides,
          },
        ],
      },
    ],
  };
}

describe("mergeBenchDetailsToState — #182/#183 field relay", () => {
  it("relays usage_reasoning_tokens and reasoning_control_ignored from run into detailAggregate", () => {
    const { detailAggregate } = mergeBenchDetailsToState([
      detail({ usage_reasoning_tokens: 30, reasoning_control_ignored: true }),
    ]);
    const agg = Object.values(detailAggregate)[0];
    expect(agg?.runs[0]?.usage_reasoning_tokens).toBe(30);
    expect(agg?.runs[0]?.reasoning_control_ignored).toBe(true);
  });

  it("relays reasoning_control_ignored into the ResultRow used by the table", () => {
    const { rows } = mergeBenchDetailsToState([detail({ reasoning_control_ignored: true })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reasoning_control_ignored).toBe(true);
  });

  it("leaves reasoning_control_ignored undefined when the run doesn't carry it", () => {
    const { rows } = mergeBenchDetailsToState([detail()]);
    expect(rows[0]?.reasoning_control_ignored).toBeUndefined();
  });

  it("구 런은 디코드 TPS만 채우고 프리필은 null", () => {
    const { rows } = mergeBenchDetailsToState([detail()]);
    // decode: (7 − 1) / ((100 − 10) / 1000) = 66.666… → 66.7
    expect(rows[0]?.tps).toBe(66.7);
    expect(rows[0]?.prefill_tps).toBeNull();
  });

  it("usage_prompt_tokens가 있으면 프리필 TPS를 채운다", () => {
    const { rows } = mergeBenchDetailsToState([detail({ usage_prompt_tokens: 50 })]);
    // 50 tok / 0.01s = 5000
    expect(rows[0]?.prefill_tps).toBe(5000);
  });
});

describe("saved comparison identity", () => {
  it("keeps identical model IDs on different servers/settings independent through every metric", async () => {
    const { scoreboardFromRows, leakMetricsFromRows, agentMetricsFromRows } = await import("@llm-bench/shared");
    const { buildChartRowsFromBenchState } = await import("./hydrateBenchUi");
    const a = detail({ quality: { pass: true, score: 1 }, usage_output_tokens: 20 });
    const b = detail({ quality: { pass: false, score: 0 }, usage_output_tokens: 2 });
    a.meta.config_id = "config-a";
    b.meta = { ...b.meta, run_id: "run_2", base_url: "http://127.0.0.1:2345", config_id: "config-b" };
    a.scenarios.push({ ...a.scenarios[0]!, id: "agent_loop_chain_v1", runs: [{ ...a.scenarios[0]!.runs[0]!, agent_completion_reason: "completed" }] });
    b.scenarios.push({ ...b.scenarios[0]!, id: "agent_loop_chain_v1", runs: [{ ...b.scenarios[0]!.runs[0]!, agent_completion_reason: "stall" }] });
    const s = mergeBenchDetailsToState([a, b]);
    expect(new Set(s.rows.map((r) => r.rowKey)).size).toBe(4);
    expect(Object.keys(s.detailAggregate)).toHaveLength(4);
    expect(s.rows.map((r) => r.model_id)).toEqual(Array(4).fill(a.meta.model_id));
    const board = scoreboardFromRows(s.rows, s.detailAggregate);
    expect(board).toHaveLength(2);
    expect(new Set(board.map((r) => r.quality.total.value)).size).toBe(2);
    expect(new Set(board.map((r) => r.speed.total.tpsMedian)).size).toBe(2);
    expect(leakMetricsFromRows(s.rows, s.detailAggregate)).toHaveLength(2);
    const agents = agentMetricsFromRows(s.rows, s.detailAggregate);
    expect(agents).toHaveLength(2);
    expect(new Set(agents.map((r) => r.task_completion_rate)).size).toBe(2);
    expect(new Set(buildChartRowsFromBenchState(s.rows, s.detailAggregate).map((r) => r.comparisonId)).size).toBe(2);
    // Also isolate settings on the SAME server, not just different endpoints.
    b.meta.base_url = a.meta.base_url;
    expect(scoreboardFromRows(mergeBenchDetailsToState([a, b]).rows, mergeBenchDetailsToState([a, b]).detailAggregate)).toHaveLength(2);
  });
});
