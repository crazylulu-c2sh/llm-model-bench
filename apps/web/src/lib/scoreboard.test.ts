import { describe, expect, it } from "vitest";
import {
  buildScoringRows,
  computeScoreboard,
  DEFAULT_SCOREBOARD_SORT,
  naturalDir,
  sameSortKey,
  scoreboardFromRows,
  sortEquals,
  sortScoreboard,
  type ScoringRow,
} from "./scoreboard";
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
    expect(board[0]!.speed.total.score).toBe(1000); // tps 30 -> 1000×30/30 (디코드 TPS-only)
  });

  it("동일 품질이면 속도(디코드 TPS) desc로 tie-break", () => {
    const board = computeScoreboard([
      srow({ model_id: "slow", scenario: "chat_hello", ttft_ms: 300, tps: 30, score: 1 }), // 1000
      srow({ model_id: "fast", scenario: "chat_hello", ttft_ms: 300, tps: 60, score: 1 }), // 2000
    ]);
    expect(board.map((b) => b.model_id)).toEqual(["fast", "slow"]);
    expect(board[0]!.speed.total.score).toBe(2000);
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

describe("기본 정렬 동등성(컴포넌트 short-circuit)", () => {
  it("DEFAULT_SCOREBOARD_SORT는 sortEquals로 자기 자신과 같다", () => {
    expect(sortEquals(DEFAULT_SCOREBOARD_SORT, { ...DEFAULT_SCOREBOARD_SORT })).toBe(true);
  });

  // 총합 품질 동점 + 속도 상이: computeScoreboard는 속도 desc로 tie-break하지만,
  // sortScoreboard(DEFAULT)는 그 2차 키가 없어 model_id로 갈린다 → 컴포넌트는 기본 정렬 시
  // 재정렬을 건너뛰고 board를 그대로 써서 속도 tie-break를 보존한다.
  it("sortScoreboard(DEFAULT)는 속도 tie-break를 잃으므로 short-circuit가 필요하다", () => {
    const board = computeScoreboard([
      srow({ model_id: "a_slow", scenario: "chat_hello", ttft_ms: 300, tps: 30, score: 1 }), // spd1000
      srow({ model_id: "z_fast", scenario: "chat_hello", ttft_ms: 300, tps: 60, score: 1 }), // spd2000
    ]);
    // computeScoreboard: 총합 품질 동점 → 속도 desc → z_fast 먼저
    expect(board.map((b) => b.model_id)).toEqual(["z_fast", "a_slow"]);
    // sortScoreboard(DEFAULT): 품질 동점 → model_id asc → a_slow 먼저(속도 무시)
    expect(sortScoreboard(board, DEFAULT_SCOREBOARD_SORT).map((b) => b.model_id)).toEqual([
      "a_slow",
      "z_fast",
    ]);
  });
});

describe("sortScoreboard", () => {
  // a: q50 spd2000 ttft100 / b: q100 spd1000 ttft300 / c: 모두 null
  const board = computeScoreboard([
    srow({ model_id: "a", scenario: "chat_hello", ttft_ms: 100, tps: 60, score: 0.5 }),
    srow({ model_id: "b", scenario: "chat_hello", ttft_ms: 300, tps: 30, score: 1 }),
    srow({ model_id: "c", scenario: "chat_hello", ttft_ms: null, tps: null, score: null }),
  ]);
  const ids = (sort: Parameters<typeof sortScoreboard>[1]) =>
    sortScoreboard(board, sort).map((b) => b.model_id);

  it("품질 desc: 높은 품질 먼저, null 맨 아래", () => {
    expect(ids({ key: { kind: "metric", group: "total", metric: "quality" }, dir: "desc" })).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("품질 asc: 비-null 역순, null은 여전히 맨 아래", () => {
    expect(ids({ key: { kind: "metric", group: "total", metric: "quality" }, dir: "asc" })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("속도 desc/asc, null 맨 아래", () => {
    expect(ids({ key: { kind: "metric", group: "total", metric: "speed" }, dir: "desc" })).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(ids({ key: { kind: "metric", group: "total", metric: "speed" }, dir: "asc" })).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("지연 asc(자연 방향): 가장 낮은 ttft 먼저, null 맨 아래", () => {
    const key = { kind: "metric", group: "total", metric: "latency" } as const;
    expect(ids({ key, dir: naturalDir(key) })).toEqual(["a", "b", "c"]);
  });

  it("지연 desc: 가장 높은 ttft 먼저, null 맨 아래", () => {
    expect(ids({ key: { kind: "metric", group: "total", metric: "latency" }, dir: "desc" })).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("모델 asc/desc는 alphanumeric", () => {
    expect(ids({ key: { kind: "model" }, dir: "asc" })).toEqual(["a", "b", "c"]);
    expect(ids({ key: { kind: "model" }, dir: "desc" })).toEqual(["c", "b", "a"]);
  });

  it("동점이면 model_id alphanumeric으로 tie-break(numeric-aware: m2 < m10)", () => {
    const tie = computeScoreboard([
      srow({ model_id: "m10", scenario: "chat_hello", ttft_ms: 200, tps: 30, score: 1 }),
      srow({ model_id: "m2", scenario: "chat_hello", ttft_ms: 200, tps: 30, score: 1 }),
    ]);
    expect(
      sortScoreboard(tie, { key: { kind: "metric", group: "total", metric: "quality" }, dir: "desc" }).map(
        (b) => b.model_id,
      ),
    ).toEqual(["m2", "m10"]);
  });

  it("그룹 독립성: text 품질 정렬 ≠ vision 품질 정렬", () => {
    const g = computeScoreboard([
      srow({ model_id: "x", scenario: "chat_hello", score: 1 }), // text q100
      srow({ model_id: "x", scenario: "vision_meme_explain_a", score: 0 }), // vision q0
      srow({ model_id: "y", scenario: "chat_hello", score: 0 }), // text q0
      srow({ model_id: "y", scenario: "vision_meme_explain_a", score: 1 }), // vision q100
    ]);
    expect(
      sortScoreboard(g, { key: { kind: "metric", group: "text", metric: "quality" }, dir: "desc" }).map(
        (b) => b.model_id,
      ),
    ).toEqual(["x", "y"]);
    expect(
      sortScoreboard(g, { key: { kind: "metric", group: "vision", metric: "quality" }, dir: "desc" }).map(
        (b) => b.model_id,
      ),
    ).toEqual(["y", "x"]);
  });

  it("입력 배열을 변형하지 않는다(비파괴)", () => {
    const before = board.map((b) => b.model_id);
    sortScoreboard(board, { key: { kind: "model" }, dir: "desc" });
    expect(board.map((b) => b.model_id)).toEqual(before);
  });
});

describe("naturalDir / sameSortKey", () => {
  it("naturalDir: 품질·속도=desc, 지연·모델=asc", () => {
    expect(naturalDir({ kind: "metric", group: "total", metric: "quality" })).toBe("desc");
    expect(naturalDir({ kind: "metric", group: "text", metric: "speed" })).toBe("desc");
    expect(naturalDir({ kind: "metric", group: "vision", metric: "latency" })).toBe("asc");
    expect(naturalDir({ kind: "model" })).toBe("asc");
  });

  it("sameSortKey: group+metric 일치/불일치, model끼리 일치", () => {
    expect(
      sameSortKey(
        { kind: "metric", group: "total", metric: "quality" },
        { kind: "metric", group: "total", metric: "quality" },
      ),
    ).toBe(true);
    expect(
      sameSortKey(
        { kind: "metric", group: "total", metric: "quality" },
        { kind: "metric", group: "total", metric: "speed" },
      ),
    ).toBe(false);
    expect(
      sameSortKey(
        { kind: "metric", group: "text", metric: "quality" },
        { kind: "metric", group: "vision", metric: "quality" },
      ),
    ).toBe(false);
    expect(sameSortKey({ kind: "model" }, { kind: "model" })).toBe(true);
    expect(sameSortKey({ kind: "model" }, { kind: "metric", group: "total", metric: "quality" })).toBe(
      false,
    );
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
    expect(board[0]!.speed.total.score).toBe(1000); // tps 30 -> 1000×30/30 (TTFT 점수 무관)
  });
});
