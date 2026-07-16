import { describe, expect, it } from "vitest";
import {
  isAgentSafe,
  leakMetricsFromBenchDetails,
  leakMetricsFromRows,
  runHasChannelTagLeak,
  runIsEmptyTurn,
  type LeakBenchDetailInput,
  type LeakResultRow,
  type LeakRunInput,
} from "./leak-metrics";

describe("leak-metrics per-run derivation", () => {
  it("runIsEmptyTurn prefers stored boolean, falls back to output_text + no tool call", () => {
    expect(runIsEmptyTurn({ output_text: "hi", empty_response: true })).toBe(true);
    expect(runIsEmptyTurn({ output_text: "", emitted_tool_call: false })).toBe(true);
    // 도구를 호출했으면 빈 content라도 정체 아님(폴백).
    expect(runIsEmptyTurn({ output_text: "", emitted_tool_call: true })).toBe(false);
    expect(runIsEmptyTurn({ output_text: "answer" })).toBe(false);
    // 사고 블록만 있고 가시 content 없음 → 빈 턴(stripThinkingBlocks가 제거).
    expect(runIsEmptyTurn({ output_text: "<think>plan</think>" })).toBe(true);
  });

  it("runHasChannelTagLeak prefers stored boolean, falls back to tag detection", () => {
    expect(runHasChannelTagLeak({ output_text: "clean", channel_tag_leak_detected: true })).toBe(true);
    expect(runHasChannelTagLeak({ output_text: "clean answer" })).toBe(false);
    expect(runHasChannelTagLeak({ output_text: "<think>x</think>visible" })).toBe(true);
  });
});

describe("leakMetricsFromBenchDetails aggregation", () => {
  it("computes thinking_leak_ratio = reasoning_tokens / total_output_tokens, clamped", () => {
    const details: LeakBenchDetailInput[] = [
      {
        meta: { model_id: "A" },
        scenarios: [
          {
            id: "chat_hello",
            api_route: "chat_completions",
            runs: [
              // reasoning 40 chars → 10 tokens; usage 40 tokens → ratio 10/40 = 0.25
              { output_text: "answer", usage_output_tokens: 40, reasoning_chars: 40 },
              // reasoning 0 → 0 tokens; usage 60 → contributes 0/60
              { output_text: "answer2", usage_output_tokens: 60 },
            ],
          },
        ],
      },
    ];
    const [row] = leakMetricsFromBenchDetails(details);
    expect(row.model_id).toBe("A");
    expect(row.api_route).toBe("chat_completions");
    // Σ reasoning tokens = 10, Σ total = 100 → 0.1
    expect(row.thinking_leak_ratio).toBeCloseTo(0.1, 6);
    expect(row.n).toBe(2);
  });

  it("clamps ratio to 1 and returns null when no measurable output", () => {
    const clamp = leakMetricsFromBenchDetails([
      {
        meta: { model_id: "B" },
        scenarios: [
          // reasoning 400 chars → 100 tokens; usage absent → denom = chars/4 of output (1 token) → clamp to 1
          { id: "chat_hello", api_route: "messages", runs: [{ output_text: "x", reasoning_chars: 400 }] },
        ],
      },
    ]);
    expect(clamp[0].thinking_leak_ratio).toBe(1);

    const noOutput = leakMetricsFromBenchDetails([
      {
        meta: { model_id: "C" },
        scenarios: [{ id: "chat_hello", api_route: "messages", runs: [{ output_text: "", usage_output_tokens: 0 }] }],
      },
    ]);
    expect(noOutput[0].thinking_leak_ratio).toBeNull();
  });

  it("empty_turn_rate and channel_tag_leak are fractions per (model, route)", () => {
    const details: LeakBenchDetailInput[] = [
      {
        meta: { model_id: "A" },
        scenarios: [
          {
            id: "chat_hello",
            api_route: "chat_completions",
            runs: [
              { output_text: "answer", usage_output_tokens: 5 },
              { output_text: "", empty_response: true, usage_output_tokens: 5 },
              { output_text: "<think>x</think>visible", channel_tag_leak_detected: true, usage_output_tokens: 5 },
              { output_text: "clean", usage_output_tokens: 5 },
            ],
          },
        ],
      },
    ];
    const [row] = leakMetricsFromBenchDetails(details);
    expect(row.empty_turn_rate).toBe(0.25); // 1/4
    expect(row.channel_tag_leak).toBe(0.25); // 1/4
  });

  it("splits by api_route (never pools routes)", () => {
    const details: LeakBenchDetailInput[] = [
      {
        meta: { model_id: "A" },
        scenarios: [
          { id: "chat_hello", api_route: "chat_completions", runs: [{ output_text: "a", usage_output_tokens: 5 }] },
          { id: "chat_hello", api_route: "messages", runs: [{ output_text: "b", usage_output_tokens: 5 }] },
        ],
      },
    ];
    const rows = leakMetricsFromBenchDetails(details);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.api_route).sort()).toEqual(["chat_completions", "messages"]);
  });

  it("#105: agent_* 시나리오는 누수 집계에서 제외(정체 유도 시나리오의 배지 오염 방지)", () => {
    const details: LeakBenchDetailInput[] = [
      {
        meta: { model_id: "A" },
        scenarios: [
          { id: "chat_hello", api_route: "chat_completions", runs: [{ output_text: "clean", usage_output_tokens: 5 }] },
          // 정체를 의도적으로 유발하는 agent 시나리오 — empty_turn_rate를 오염시키면 안 된다.
          { id: "agent_loop_budget_v1", api_route: "chat_completions", runs: [{ output_text: "", empty_response: true, usage_output_tokens: 5 }] },
        ],
      },
    ];
    const [row] = leakMetricsFromBenchDetails(details);
    expect(row.n).toBe(1); // chat_hello 런만
    expect(row.empty_turn_rate).toBe(0); // agent 정체는 카운트 안 됨
  });
});

describe("server ≡ browser leak parity", () => {
  const runs: LeakRunInput[] = [
    { output_text: "answer", usage_output_tokens: 20, reasoning_chars: 20 },
    { output_text: "", empty_response: true, usage_output_tokens: 5 },
  ];
  const details: LeakBenchDetailInput[] = [
    { meta: { model_id: "A" }, scenarios: [{ id: "chat_hello", api_route: "chat_completions", runs }] },
  ];
  const rows: LeakResultRow[] = [{ model_id: "A", api: "chat_completions", rowKey: "k1", scenario: "chat_hello" }];
  const aggregate = { k1: { runs } };

  it("leakMetricsFromBenchDetails ≡ leakMetricsFromRows", () => {
    expect(leakMetricsFromRows(rows, aggregate)).toEqual(leakMetricsFromBenchDetails(details));
  });
});

describe("isAgentSafe", () => {
  it("true only when all three metrics are at or below thresholds (null leak passes)", () => {
    expect(isAgentSafe({ thinking_leak_ratio: 0.01, empty_turn_rate: 0, channel_tag_leak: 0, n: 3 })).toBe(true);
    expect(isAgentSafe({ thinking_leak_ratio: null, empty_turn_rate: 0, channel_tag_leak: 0, n: 3 })).toBe(true);
    expect(isAgentSafe({ thinking_leak_ratio: 0.5, empty_turn_rate: 0, channel_tag_leak: 0, n: 3 })).toBe(false);
    expect(isAgentSafe({ thinking_leak_ratio: 0, empty_turn_rate: 0.5, channel_tag_leak: 0, n: 3 })).toBe(false);
  });
});
