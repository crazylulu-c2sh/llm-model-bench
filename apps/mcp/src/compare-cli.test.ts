import type { CompareResponse } from "@llm-bench/shared";
import { describe, expect, it } from "vitest";
import { exitCodeFor, formatCompareSummary } from "./compare-cli.js";

function response(regression: boolean): CompareResponse {
  return {
    runA: { run_id: "a", model_id: "modelA" },
    runB: { run_id: "b", model_id: "modelB" },
    thresholds: { qualityDropAbs: 0.05, tpsRegressionPct: 0.15, ttftRegressionPct: 0.25, flagNewEmptyTurns: true },
    scenarios: [
      {
        scenario: "chat_ping",
        api_route: "chat_completions",
        ttft_p50: { a: 100, b: 120, delta: 20, pct: 0.2 },
        ttft_p95: { a: 100, b: 120, delta: 20, pct: 0.2 },
        tps_per_user: { a: 30, b: 28, delta: -2, pct: -0.067 },
        tps_aggregate: { a: 30, b: 28, delta: -2, pct: -0.067 },
        quality: { a: 1, b: regression ? 0.33 : 1, delta: regression ? -0.67 : 0, pct: null },
        empty_turn_rate: { a: 0, b: 0, delta: 0, pct: null },
        channel_tag_leak: { a: 0, b: 0, delta: 0, pct: null },
        regressions: regression ? ["quality_drop"] : [],
        regression,
      },
    ],
    summary: {
      regression,
      regressions: regression ? ["quality_drop"] : [],
      scenarios_regressed: regression ? 1 : 0,
      scenarios_compared: 1,
    },
  };
}

describe("compare-cli helpers (#84)", () => {
  it("exitCodeFor: 1 only when regression AND --fail-on-regression", () => {
    expect(exitCodeFor(response(true), true)).toBe(1);
    expect(exitCodeFor(response(true), false)).toBe(0);
    expect(exitCodeFor(response(false), true)).toBe(0);
  });

  it("formatCompareSummary marks regression / clean", () => {
    expect(formatCompareSummary(response(true))).toContain("REGRESSION");
    expect(formatCompareSummary(response(true))).toContain("quality_drop");
    expect(formatCompareSummary(response(false))).toContain("clean");
  });
});
