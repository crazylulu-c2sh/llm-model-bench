import { describe, expect, it } from "vitest";
import {
  computeCompare,
  ttftPercentiles,
  type CompareBenchDetailInput,
  type CompareRunInput,
} from "./compare";

function run(overrides: Partial<CompareRunInput> = {}): CompareRunInput {
  return {
    ttft_ms: 100,
    total_ms: 1000,
    output_text: "x".repeat(40), // ~10 approx tokens
    usage_output_tokens: 100,
    quality: { pass: true, score: 1 },
    ...overrides,
  };
}

function detail(model: string, runs: CompareRunInput[], runId = `${model}_run`): CompareBenchDetailInput {
  return {
    meta: { model_id: model, base_url: "http://x", run_id: runId },
    scenarios: [{ id: "chat_ping", api_route: "chat_completions", runs }],
  };
}

describe("ttftPercentiles (nearest-rank)", () => {
  it("computes p50/p95, null on empty", () => {
    expect(ttftPercentiles([10, 20, 30, 40, 50])).toEqual({ p50: 30, p95: 50 });
    expect(ttftPercentiles([])).toEqual({ p50: null, p95: null });
    // 유한·비음수만
    expect(ttftPercentiles([NaN, -5, 20])).toEqual({ p50: 20, p95: 20 });
  });
});

describe("computeCompare regression classification", () => {
  it("clean when identical", () => {
    const res = computeCompare(detail("A", [run()]), detail("B", [run()]));
    expect(res.summary.regression).toBe(false);
    expect(res.summary.scenarios_compared).toBe(1);
    expect(res.scenarios[0]!.quality).toMatchObject({ a: 1, b: 1, delta: 0 });
  });

  it("quality_drop when quality falls beyond threshold", () => {
    const res = computeCompare(
      detail("A", [run({ quality: { pass: true, score: 1 } })]),
      detail("B", [run({ quality: { pass: false, score: 0.33 } })]),
    );
    expect(res.scenarios[0]!.regressions).toContain("quality_drop");
    expect(res.summary.regression).toBe(true);
  });

  it("new_empty_turns when B introduces empty turns A didn't have", () => {
    const res = computeCompare(
      detail("A", [run(), run()]),
      detail("B", [run(), run({ output_text: "", empty_response: true })]),
    );
    expect(res.scenarios[0]!.regressions).toContain("new_empty_turns");
  });

  it("tps_regression when aggregate TPS drops beyond threshold", () => {
    // A: 100 tok / 1s = 100 tps; B: 100 tok / 2s = 50 tps (< 85%)
    const res = computeCompare(
      detail("A", [run({ total_ms: 1000, usage_output_tokens: 100 })]),
      detail("B", [run({ total_ms: 2000, usage_output_tokens: 100 })]),
    );
    expect(res.scenarios[0]!.regressions).toContain("tps_regression");
  });

  it("ttft_regression when p95 rises beyond threshold", () => {
    const res = computeCompare(
      detail("A", [run({ ttft_ms: 100 })]),
      detail("B", [run({ ttft_ms: 200 })]), // +100% > 25%
    );
    expect(res.scenarios[0]!.regressions).toContain("ttft_regression");
  });

  it("honors threshold overrides (loose thresholds → no regression)", () => {
    const res = computeCompare(
      detail("A", [run({ quality: { pass: true, score: 1 } })]),
      detail("B", [run({ quality: { pass: false, score: 0.5 } })]),
      { qualityDropAbs: 0.9 },
    );
    expect(res.scenarios[0]!.regressions).not.toContain("quality_drop");
  });

  it("only compares scenarios present in both (joined by scenario|route)", () => {
    const a: CompareBenchDetailInput = {
      meta: { model_id: "A" },
      scenarios: [
        { id: "chat_ping", api_route: "chat_completions", runs: [run()] },
        { id: "only_in_a", api_route: "chat_completions", runs: [run()] },
      ],
    };
    const b: CompareBenchDetailInput = {
      meta: { model_id: "B" },
      scenarios: [{ id: "chat_ping", api_route: "chat_completions", runs: [run()] }],
    };
    const res = computeCompare(a, b);
    expect(res.summary.scenarios_compared).toBe(1);
    expect(res.scenarios[0]!.scenario).toBe("chat_ping");
  });

  it("is deterministic (same input → same output)", () => {
    const a = detail("A", [run(), run({ ttft_ms: 50 })]);
    const b = detail("B", [run({ ttft_ms: 300 }), run()]);
    expect(computeCompare(a, b)).toEqual(computeCompare(a, b));
  });
});
