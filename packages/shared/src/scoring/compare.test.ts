import { describe, expect, it } from "vitest";
import {
  PROTOCOL_AXES,
  computeCompare,
  protocolMismatchFor,
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

describe("computeCompare: 측정 프로토콜 축(#174) 게이트", () => {
  /** 두 라우트를 모두 가진 상세 — `affects` 동작을 가르기 위해 필요. */
  function twoRouteDetail(
    model: string,
    runs: CompareRunInput[],
    meta: Partial<CompareBenchDetailInput["meta"]> = {},
  ): CompareBenchDetailInput {
    return {
      meta: { model_id: model, base_url: "http://x", run_id: `${model}_run`, ...meta },
      scenarios: [
        { id: "chat_ping", api_route: "chat_completions", runs },
        { id: "chat_ping", api_route: "messages", runs },
      ],
    };
  }

  /** B가 A보다 품질이 크게 떨어져, 게이트가 없으면 반드시 quality_drop이 뜨는 쌍. */
  const good = run({ quality: { pass: true, score: 1 } });
  const bad = run({ quality: { pass: false, score: 0 } });

  it("상한이 같으면 평소대로 회귀를 잡는다", () => {
    const res = computeCompare(
      twoRouteDetail("A", [good], { max_tokens_effective: 512 }),
      twoRouteDetail("B", [bad], { max_tokens_effective: 512 }),
    );
    expect(res.summary.regression).toBe(true);
    expect(res.summary.scenarios_incomparable).toBe(0);
    for (const sc of res.scenarios) {
      expect(sc.comparable).toBe(true);
      expect(sc.protocol_mismatch).toEqual([]);
      expect(sc.regressions).toContain("quality_drop");
    }
  });

  it("상한이 다르면 두 라우트 모두 비교 불가로 두고 회귀를 세지 않는다", () => {
    const res = computeCompare(
      twoRouteDetail("A", [good], { max_tokens_effective: 293 }),
      twoRouteDetail("B", [bad], { max_tokens_effective: 4096 }),
    );
    // `affects: "all"` 이므로 chat_completions·messages 둘 다 걸린다.
    expect(res.scenarios).toHaveLength(2);
    for (const sc of res.scenarios) {
      expect(sc.comparable).toBe(false);
      expect(sc.protocol_mismatch).toEqual(["max_tokens_effective"]);
      expect(sc.regressions).toEqual([]);
      expect(sc.regression).toBe(false);
    }
    expect(res.summary.regression).toBe(false);
    expect(res.summary.regressions).toEqual([]);
    expect(res.summary.scenarios_regressed).toBe(0);
    expect(res.summary.scenarios_incomparable).toBe(2);
  });

  it("델타 숫자 자체는 그대로 보여 준다 — 회귀로만 세지 않는다", () => {
    const res = computeCompare(
      twoRouteDetail("A", [good], { max_tokens_effective: 293 }),
      twoRouteDetail("B", [bad], { max_tokens_effective: 4096 }),
    );
    expect(res.scenarios[0]!.quality).toMatchObject({ a: 1, b: 0, delta: -1 });
  });

  it("한쪽이 필드 없는 과거 런이면 불일치로 본다", () => {
    const res = computeCompare(
      twoRouteDetail("A", [good]), // max_tokens_effective 없음 → null
      twoRouteDetail("B", [bad], { max_tokens_effective: 512 }),
    );
    expect(res.scenarios[0]!.protocol_mismatch).toEqual(["max_tokens_effective"]);
    expect(res.summary.scenarios_incomparable).toBe(2);
  });

  it("양쪽 다 과거 런이면(둘 다 필드 부재) 평소대로 비교한다", () => {
    const res = computeCompare(twoRouteDetail("A", [good]), twoRouteDetail("B", [bad]));
    expect(res.summary.scenarios_incomparable).toBe(0);
    expect(res.summary.regression).toBe(true);
  });
});

describe("protocolMismatchFor: affects 라우트 한정(#173 축이 붙을 자리)", () => {
  it("`affects`가 라우트를 한정하면 그 라우트만 걸린다", () => {
    const axes: Array<{
      key: string;
      read: (m: { run_id?: string }) => unknown;
      affects: readonly string[];
    }> = [{ key: "thinking_like", read: (m) => m.run_id, affects: ["messages"] }];
    const affected = (route: string) =>
      axes
        .filter(
          (ax) =>
            ax.affects.includes(route) && ax.read({ run_id: "a" }) !== ax.read({ run_id: "b" }),
        )
        .map((ax) => ax.key);
    expect(affected("messages")).toEqual(["thinking_like"]);
    expect(affected("chat_completions")).toEqual([]);
  });

  it("등록된 축과 각자의 affects", () => {
    expect(PROTOCOL_AXES.map((a) => a.key)).toEqual([
      "max_tokens_effective",
      "anthropic_thinking_requested",
    ]);
    // 출력 상한은 양쪽 라우트를, 사고 요청 여부는 messages만 오염시킨다.
    expect(PROTOCOL_AXES[0]!.affects).toBe("all");
    expect(PROTOCOL_AXES[1]!.affects).toEqual(["messages"]);
  });

  it("max_tokens 축은 두 라우트 모두에 걸린다", () => {
    const a = { model_id: "A", anthropic_thinking_requested: false };
    const b = { model_id: "B", max_tokens_effective: 1, anthropic_thinking_requested: false };
    expect(protocolMismatchFor("chat_completions", a, b)).toEqual(["max_tokens_effective"]);
    expect(protocolMismatchFor("messages", a, b)).toEqual(["max_tokens_effective"]);
  });

  it("thinking 축은 messages 에만 걸린다 (#173)", () => {
    const a = { model_id: "A", max_tokens_effective: 512, anthropic_thinking_requested: false };
    const b = { model_id: "B", max_tokens_effective: 512, anthropic_thinking_requested: true };
    expect(protocolMismatchFor("messages", a, b)).toEqual(["anthropic_thinking_requested"]);
    expect(protocolMismatchFor("chat_completions", a, b)).toEqual([]);
  });

  it("과거 런(필드 부재)은 thinking 미요청으로 읽힌다", () => {
    const legacy = { model_id: "A", max_tokens_effective: 512 };
    const withThinking = {
      model_id: "B",
      max_tokens_effective: 512,
      anthropic_thinking_requested: true,
    };
    expect(protocolMismatchFor("messages", legacy, withThinking)).toEqual([
      "anthropic_thinking_requested",
    ]);
    const legacyB = { model_id: "B", max_tokens_effective: 512 };
    expect(protocolMismatchFor("messages", legacy, legacyB)).toEqual([]);
  });

  it("두 축이 동시에 어긋나면 둘 다 보고한다", () => {
    expect(
      protocolMismatchFor(
        "messages",
        { model_id: "A" },
        { model_id: "B", max_tokens_effective: 1, anthropic_thinking_requested: true },
      ),
    ).toEqual(["max_tokens_effective", "anthropic_thinking_requested"]);
  });
});
