import { describe, expect, it } from "vitest";
import { computeSpeedScores, speedScoreForRow, tpsSpeedRatio, type SpeedInput } from "./speed-score";

describe("tpsSpeedRatio (기준 30 tok/s 대비)", () => {
  it("기준 대비 비율", () => {
    expect(tpsSpeedRatio(30)).toBe(1);
    expect(tpsSpeedRatio(60)).toBe(2);
    expect(tpsSpeedRatio(15)).toBe(0.5);
  });
  it("null / NaN / <=0 -> null", () => {
    expect(tpsSpeedRatio(null)).toBeNull();
    expect(tpsSpeedRatio(undefined)).toBeNull();
    expect(tpsSpeedRatio(Number.NaN)).toBeNull();
    expect(tpsSpeedRatio(-3)).toBeNull();
    expect(tpsSpeedRatio(0)).toBeNull();
  });
});

describe("speedScoreForRow (디코드 TPS-only, 상한 없음, 기준 1000)", () => {
  const row = (p: Partial<SpeedInput>): SpeedInput => ({
    model_id: "A",
    scenario: "chat_hello",
    ttft_ms: null,
    tps: null,
    ...p,
  });
  it("기준=1000, 선형 비례, 상한 없음", () => {
    expect(speedScoreForRow(row({ tps: 30 }))).toBe(1000);
    expect(speedScoreForRow(row({ tps: 60 }))).toBe(2000);
    expect(speedScoreForRow(row({ tps: 15 }))).toBe(500);
    expect(speedScoreForRow(row({ tps: 120 }))).toBe(4000);
  });
  it("TTFT는 점수에 미반영 — tps 없으면 null, ttft 값은 점수 불변", () => {
    expect(speedScoreForRow(row({ tps: null, ttft_ms: 300 }))).toBeNull();
    expect(speedScoreForRow(row({ tps: 30, ttft_ms: 5000 }))).toBe(1000);
    expect(speedScoreForRow(row({}))).toBeNull();
  });
});

describe("computeSpeedScores (model_id로 풀링; 점수=tps, 지연=ttft 독립 집계)", () => {
  it("text/total 풀링; vision opt-out -> '—' + textOnly; ttftMs 평균", () => {
    const m = computeSpeedScores([
      { model_id: "A", scenario: "chat_hello", tps: 30, ttft_ms: 300 }, // 1000
      { model_id: "A", scenario: "code_sort_js", tps: 15, ttft_ms: 2000 }, // 500
    ]).get("A")!;
    expect(m.vision.score).toBeNull();
    expect(m.textOnly).toBe(true);
    expect(m.text.score).toBe(750); // round((1000+500)/2)
    expect(m.total.score).toBe(750);
    expect(m.text.ttftMs).toBe(1150); // round((300+2000)/2)
  });

  it("vision 시나리오는 vision 슬라이스로; total은 전체 풀링", () => {
    const m = computeSpeedScores([
      { model_id: "A", scenario: "chat_hello", tps: 30, ttft_ms: 300 }, // 1000
      { model_id: "A", scenario: "vision_table_ocr_a", tps: 5, ttft_ms: 5000 }, // 166.67
    ]).get("A")!;
    expect(m.vision.score).toBe(167); // round(1000*5/30)
    expect(m.textOnly).toBe(false);
    expect(m.total.score).toBe(583); // round((1000 + 1000*5/30)/2) — 총평균에서 1회만 반올림
    expect(m.vision.ttftMs).toBe(5000);
    expect(m.total.ttftMs).toBe(2650); // round((300+5000)/2)
  });

  it("api route 가로질러 풀링 (2행, 같은 시나리오)", () => {
    const m = computeSpeedScores([
      { model_id: "A", scenario: "chat_hello", tps: 30, ttft_ms: 300 },
      { model_id: "A", scenario: "chat_hello", tps: 5, ttft_ms: 5000 },
    ]).get("A")!;
    expect(m.total.scoredRows).toBe(2);
  });

  it("approx tps는 caveat로 표시되나 점수엔 포함", () => {
    const m = computeSpeedScores([
      { model_id: "A", scenario: "chat_hello", tps: 15, ttft_ms: 2000, tps_source: "approx" },
    ]).get("A")!;
    expect(m.approxCaveat).toBe(true);
    expect(m.total.approxRows).toBe(1);
    expect(m.total.score).toBe(500);
    expect(m.total.ttftMs).toBe(2000);
  });

  it("tps 없음 -> 점수 제외; ttft만 있으면 지연 열엔 집계", () => {
    const m = computeSpeedScores([
      { model_id: "A", scenario: "chat_hello", tps: null, ttft_ms: 250 },
    ]).get("A")!;
    expect(m.total.score).toBeNull();
    expect(m.total.scoredRows).toBe(0);
    expect(m.total.ttftMs).toBe(250);
    expect(m.textOnly).toBe(true);
  });
});
