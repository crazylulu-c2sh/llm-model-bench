import { describe, expect, it } from "vitest";
import {
  averageRunsToScoringRow,
  buildScoringRows,
  computeScoreboard,
  scoringRowsFromBenchDetails,
  type ScoringAggregate,
  type ScoringBenchDetailInput,
  type ScoringResultRow,
  type ScoringRunInput,
} from "./scoreboard";

// 두 경로(웹 buildScoringRows / 서버 scoringRowsFromBenchDetails)가 같은 데이터에서
// 바이트 단위로 동일한 ScoringRow[]를 내는지 잠근다 — server ≡ browser 회귀 게이트.
describe("scoreboard parity (server ≡ browser)", () => {
  const chatRuns: ScoringRunInput[] = [
    { ttft_ms: 100, total_ms: 1000, output_text: "abcd", usage_output_tokens: 10, quality: { pass: true, score: 1 } },
    { ttft_ms: 200, total_ms: 1000, output_text: "abcd", usage_output_tokens: 10, quality: { pass: false, score: 0 } },
  ];
  const visionRuns: ScoringRunInput[] = [
    {
      ttft_ms: 150,
      total_ms: 2000,
      output_text: "x".repeat(80),
      quality: { pass: false, score: 0.33, reason: "prefilter passed — set LLM_JUDGE_ENABLED=1 for rubric judging" },
    },
  ];

  const rows: ScoringResultRow[] = [
    { rowKey: "k1", model_id: "A", scenario: "chat_hello", api: "chat_completions", ttft_ms: null },
    { rowKey: "k2", model_id: "A", scenario: "vision_meme_explain_a", api: "chat_completions", ttft_ms: null },
  ];
  const aggregate: ScoringAggregate = { k1: { runs: chatRuns }, k2: { runs: visionRuns } };

  const details: ScoringBenchDetailInput[] = [
    {
      meta: { model_id: "A" },
      scenarios: [
        { id: "chat_hello", api_route: "chat_completions", runs: chatRuns },
        { id: "vision_meme_explain_a", api_route: "chat_completions", runs: visionRuns },
      ],
    },
  ];

  it("buildScoringRows ≡ scoringRowsFromBenchDetails", () => {
    const web = buildScoringRows(rows, aggregate);
    const server = scoringRowsFromBenchDetails(details);
    expect(server).toEqual(web);
  });

  it("computeScoreboard is identical for both paths", () => {
    expect(computeScoreboard(scoringRowsFromBenchDetails(details))).toEqual(
      computeScoreboard(buildScoringRows(rows, aggregate)),
    );
  });

  it("averageRunsToScoringRow averages runs (chat) and flags judge-cap (vision)", () => {
    const chat = averageRunsToScoringRow("A", "chat_hello", "chat_completions", chatRuns);
    expect(chat.score).toBe(0.5); // (1+0)/2
    expect(chat.ttft_ms).toBe(150); // (100+200)/2
    expect(chat.judgeCapped).toBe(false);
    const vision = averageRunsToScoringRow("A", "vision_meme_explain_a", "chat_completions", visionRuns);
    expect(vision.judgeCapped).toBe(true);
  });

  it("filter drops non-matching scenarios", () => {
    const only = scoringRowsFromBenchDetails(details, (id) => id === "chat_hello");
    expect(only.map((r) => r.scenario)).toEqual(["chat_hello"]);
  });
});
