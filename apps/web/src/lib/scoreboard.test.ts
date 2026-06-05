import { describe, expect, it } from "vitest";
import { buildScoringRows, computeScoreboard, scoreboardFromRows, type ScoringRow } from "./scoreboard";
import type { ResultRow } from "../components/ResultsTable";

function rrow(p: Partial<ResultRow> & { rowKey: string; model_id: string; scenario: string }): ResultRow {
  return { api: "chat_completions", ttft_ms: null, ...p };
}

function srow(p: Partial<ScoringRow> & { model_id: string; scenario: string }): ScoringRow {
  return { api: "chat_completions", ttft_ms: null, tps: null, score: null, judgeCapped: false, ...p };
}

describe("buildScoringRows", () => {
  it("averages quality/ttft across measured runs (not last-run)", () => {
    const rows = [rrow({ rowKey: "k1", model_id: "A", scenario: "chat_hello", score: 0, ttft_ms: 999 })];
    const agg = {
      k1: {
        runs: [
          { ttft_ms: 100, total_ms: 1000, output_text: "abcd", usage_output_tokens: 10, quality: { pass: true, score: 1 } },
          { ttft_ms: 200, total_ms: 1000, output_text: "abcd", usage_output_tokens: 10, quality: { pass: false, score: 0 } },
        ],
      },
    };
    const [sr] = buildScoringRows(rows, agg);
    expect(sr!.score).toBe(0.5); // (1+0)/2 — NOT the row's last-run 0
    expect(sr!.ttft_ms).toBe(150); // (100+200)/2
  });

  it("falls back to ResultRow when no runs", () => {
    const rows = [rrow({ rowKey: "k1", model_id: "A", scenario: "chat_hello", ttft_ms: 120, tps: 22, score: 1 })];
    const [sr] = buildScoringRows(rows, {});
    expect(sr!.ttft_ms).toBe(120);
    expect(sr!.tps).toBe(22);
    expect(sr!.score).toBe(1);
  });

  it("flags judge-capped vision run", () => {
    const rows = [rrow({ rowKey: "k1", model_id: "A", scenario: "vision_meme_explain_a" })];
    const agg = {
      k1: {
        runs: [
          {
            ttft_ms: 100,
            total_ms: 1000,
            output_text: "x",
            quality: { pass: false, score: 0.33, reason: "prefilter passed — set LLM_JUDGE_ENABLED=1 for rubric judging" },
          },
        ],
      },
    };
    const [sr] = buildScoringRows(rows, agg);
    expect(sr!.judgeCapped).toBe(true);
  });
});

describe("computeScoreboard", () => {
  it("zips quality+speed; sorts by total quality desc then alphanumeric", () => {
    const board = computeScoreboard([
      srow({ model_id: "low", scenario: "chat_hello", ttft_ms: 300, tps: 30, score: 0, tps_source: "usage" }),
      srow({ model_id: "high", scenario: "chat_hello", ttft_ms: 300, tps: 30, score: 1, tps_source: "usage" }),
    ]);
    expect(board.map((b) => b.model_id)).toEqual(["high", "low"]);
    expect(board[0]!.quality.total.value).toBe(100);
    expect(board[0]!.speed.total.score).toBe(93); // 0.7*90 + 0.3*100
  });

  it("nulls sort last", () => {
    const board = computeScoreboard([
      srow({ model_id: "scored", scenario: "chat_hello", ttft_ms: 300, tps: 30, score: 1 }),
      srow({ model_id: "unscored", scenario: "chat_hello", ttft_ms: 300, tps: 30, score: null }),
    ]);
    expect(board[0]!.model_id).toBe("scored");
    expect(board[1]!.model_id).toBe("unscored");
  });

  it("textOnly true iff model ran no vision rows", () => {
    const board = computeScoreboard([
      srow({ model_id: "A", scenario: "chat_hello", ttft_ms: 300, tps: 30, score: 1 }),
    ]);
    expect(board[0]!.textOnly).toBe(true);
  });

  it("empty input -> []", () => {
    expect(computeScoreboard([])).toEqual([]);
  });
});

describe("scoreboardFromRows (end-to-end)", () => {
  it("uses run-averaged quality, not the ResultRow last-run value", () => {
    const rows = [rrow({ rowKey: "k1", model_id: "A", scenario: "chat_hello", score: 0, ttft_ms: 999 })];
    const agg = {
      k1: {
        runs: [
          { ttft_ms: 300, total_ms: 1000, output_text: "x".repeat(120), usage_output_tokens: 30, quality: { pass: true, score: 1 } },
          { ttft_ms: 300, total_ms: 1000, output_text: "x".repeat(120), usage_output_tokens: 30, quality: { pass: true, score: 1 } },
        ],
      },
    };
    const board = scoreboardFromRows(rows, agg);
    expect(board).toHaveLength(1);
    expect(board[0]!.quality.total.value).toBe(100); // averaged 1, not row's 0
    expect(board[0]!.speed.total.score).toBe(93); // tps 30 -> 90, ttft 300 -> 100
  });
});
