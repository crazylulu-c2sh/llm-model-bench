import { describe, expect, it } from "vitest";
import { buildScoreboardChartData, reorderChartDataByVendor } from "./scoreboard-chart";
import {
  computeScoreboard,
  DEFAULT_SCOREBOARD_SORT,
  sortScoreboard,
  type ScoringRow,
} from "./scoreboard";

function srow(p: Partial<ScoringRow> & { model_id: string; scenario: string }): ScoringRow {
  return { api: "chat_completions", ttft_ms: null, tps: null, score: null, judgeCapped: false, ...p };
}

describe("buildScoreboardChartData 정렬", () => {
  it("총합/품질 랭킹은 board 순서와 정확히 일치(속도 tie-break 보존, sortScoreboard(DEFAULT) 아님)", () => {
    const board = computeScoreboard([
      srow({ model_id: "a_slow", scenario: "chat_hello", ttft_ms: 300, tps: 30, score: 1 }), // spd1000
      srow({ model_id: "z_fast", scenario: "chat_hello", ttft_ms: 300, tps: 60, score: 1 }), // spd2000
    ]);
    // computeScoreboard: 총합 품질 동점 → 속도 desc → z_fast 먼저
    expect(board.map((b) => b.model_id)).toEqual(["z_fast", "a_slow"]);
    // 차트는 board 순서를 그대로 써야 한다
    expect(buildScoreboardChartData(board, "total", "quality").data.map((d) => d.model_id)).toEqual([
      "z_fast",
      "a_slow",
    ]);
    // 그냥 sortScoreboard(DEFAULT)를 썼다면 속도 tie-break를 잃어 [a_slow, z_fast]가 됐을 것
    expect(sortScoreboard(board, DEFAULT_SCOREBOARD_SORT).map((b) => b.model_id)).toEqual([
      "a_slow",
      "z_fast",
    ]);
  });

  it("속도 지표는 속도 desc 랭킹 + 열 최고점 상대 밴드색", () => {
    const board = computeScoreboard([
      srow({ model_id: "a", scenario: "chat_hello", ttft_ms: 100, tps: 60, score: 0.5 }), // spd2000
      srow({ model_id: "b", scenario: "chat_hello", ttft_ms: 300, tps: 30, score: 1 }), //   spd1000
    ]);
    const { data, max, domainMax } = buildScoreboardChartData(board, "total", "speed");
    expect(data.map((d) => d.model_id)).toEqual(["a", "b"]); // 속도 desc(품질과 무관)
    expect(max).toBe(2000);
    expect(data[0]!.color).toBe("var(--tier-fast)"); // 2000/2000=1.0 → high
    expect(data[1]!.color).toBe("var(--tier-okay)"); // 1000/2000=0.5 → mid
    expect(domainMax).toBe(2000); // niceCeil(2000)
  });

  it("품질 밴드색은 절대 임계(90/70/50)", () => {
    const board = computeScoreboard([
      srow({ model_id: "hi", scenario: "chat_hello", tps: 30, score: 1 }), // q100 high
      srow({ model_id: "mid", scenario: "chat_hello", tps: 30, score: 0.5 }), // q50 mid
      srow({ model_id: "lo", scenario: "chat_hello", tps: 30, score: 0 }), // q0 low
    ]);
    const byId = new Map(
      buildScoreboardChartData(board, "total", "quality").data.map((d) => [d.model_id, d]),
    );
    expect(byId.get("hi")!.color).toBe("var(--tier-fast)");
    expect(byId.get("mid")!.color).toBe("var(--tier-okay)");
    expect(byId.get("lo")!.color).toBe("var(--tier-slow)");
  });
});

describe("buildScoreboardChartData null·평균·domain", () => {
  it("null은 맨 아래·isNull·rank 미부여, average는 널 제외", () => {
    const board = computeScoreboard([
      srow({ model_id: "scored", scenario: "chat_hello", ttft_ms: 300, tps: 30, score: 1 }),
      srow({ model_id: "unscored", scenario: "chat_hello", ttft_ms: null, tps: null, score: null }),
    ]);
    const { data, average } = buildScoreboardChartData(board, "total", "quality");
    expect(data.map((d) => d.model_id)).toEqual(["scored", "unscored"]);
    expect(data[0]).toMatchObject({ rank: 1, isNull: false, value: 100 });
    expect(data[1]).toMatchObject({ rank: 0, isNull: true, value: null, color: "var(--border)" });
    expect(average).toBe(100); // 널 제외 → scored만
  });

  it("전부 null이면 average undefined, 품질 domainMax는 항상 100", () => {
    const board = computeScoreboard([srow({ model_id: "x", scenario: "chat_hello", score: null })]);
    const { data, average, domainMax } = buildScoreboardChartData(board, "total", "quality");
    expect(data[0]!.isNull).toBe(true);
    expect(average).toBeUndefined();
    expect(domainMax).toBe(100);
  });
});

describe("buildScoreboardChartData caveat 그룹 규칙(표와 일치)", () => {
  const board = computeScoreboard([
    // text: approx tps / vision: judge-capped
    srow({
      model_id: "m",
      scenario: "chat_hello",
      ttft_ms: 100,
      tps: 30,
      tps_source: "approx",
      score: 1,
    }),
    srow({ model_id: "m", scenario: "vision_meme_explain_a", ttft_ms: 100, tps: 30, score: 1, judgeCapped: true }),
  ]);

  it("judge-cap은 품질 지표 + 비전/총합 그룹에만(텍스트는 false)", () => {
    expect(buildScoreboardChartData(board, "text", "quality").data[0]!.capped).toBe(false);
    expect(buildScoreboardChartData(board, "vision", "quality").data[0]!.capped).toBe(true);
    expect(buildScoreboardChartData(board, "total", "quality").data[0]!.capped).toBe(true);
    // 속도 지표는 capped 항상 false
    expect(buildScoreboardChartData(board, "total", "speed").data[0]!.capped).toBe(false);
  });

  it("approx는 속도 지표 + approx 행이 있는 그룹에만", () => {
    expect(buildScoreboardChartData(board, "text", "speed").data[0]!.approx).toBe(true);
    expect(buildScoreboardChartData(board, "vision", "speed").data[0]!.approx).toBe(false);
    expect(buildScoreboardChartData(board, "total", "speed").data[0]!.approx).toBe(true);
    // 품질 지표는 approx 항상 false
    expect(buildScoreboardChartData(board, "total", "quality").data[0]!.approx).toBe(false);
  });
});

describe("buildScoreboardChartData 기타", () => {
  it("textOnly 플래그 전파", () => {
    const board = computeScoreboard([srow({ model_id: "t", scenario: "chat_hello", tps: 30, score: 1 })]);
    expect(buildScoreboardChartData(board, "total", "quality").data[0]!.textOnly).toBe(true);
  });

  it("reorderChartDataByVendor: 벤더 그룹으로 안정 정렬(내부 metric 순서 유지, unknown 뒤)", () => {
    const board = computeScoreboard([
      srow({ model_id: "gemma-4-e2b", scenario: "chat_hello", tps: 30, score: 1 }), // google, q100
      srow({ model_id: "qwen2.5-7b", scenario: "chat_hello", tps: 30, score: 0.9 }), // alibaba, q90
      srow({ model_id: "gemma-3-2b", scenario: "chat_hello", tps: 30, score: 0.8 }), // google, q80
      srow({ model_id: "mystery-x", scenario: "chat_hello", tps: 30, score: 0.7 }), // unknown, q70
    ]);
    const { data } = buildScoreboardChartData(board, "total", "quality");
    // metric 순서: gemma-4-e2b(100) > qwen2.5-7b(90) > gemma-3-2b(80) > mystery-x(70)
    const vendorOf = (id: string) =>
      id.startsWith("gemma") ? "google" : id.startsWith("qwen") ? "alibaba" : "unknown";
    const ordered = reorderChartDataByVendor(data, vendorOf).map((d) => d.model_id);
    // alibaba < google < unknown(뒤). 그룹 내부는 metric 순서 유지(gemma-4-e2b 먼저).
    expect(ordered).toEqual(["qwen2.5-7b", "gemma-4-e2b", "gemma-3-2b", "mystery-x"]);
    // rank는 그대로 metric 랭킹
    const byId = new Map(reorderChartDataByVendor(data, vendorOf).map((d) => [d.model_id, d.rank]));
    expect(byId.get("gemma-4-e2b")).toBe(1);
    expect(byId.get("mystery-x")).toBe(4);
  });

  it("그룹 독립성: 텍스트 품질 랭킹 ≠ 비전 품질 랭킹", () => {
    const board = computeScoreboard([
      srow({ model_id: "x", scenario: "chat_hello", score: 1 }), // text q100
      srow({ model_id: "x", scenario: "vision_meme_explain_a", score: 0 }), // vision q0
      srow({ model_id: "y", scenario: "chat_hello", score: 0 }), // text q0
      srow({ model_id: "y", scenario: "vision_meme_explain_a", score: 1 }), // vision q100
    ]);
    expect(buildScoreboardChartData(board, "text", "quality").data.map((d) => d.model_id)).toEqual([
      "x",
      "y",
    ]);
    expect(buildScoreboardChartData(board, "vision", "quality").data.map((d) => d.model_id)).toEqual([
      "y",
      "x",
    ]);
  });
});
