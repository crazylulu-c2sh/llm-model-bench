import { describe, expect, it } from "vitest";
import {
  computeSpeedScores,
  speedScoreForRow,
  tpsToSpeedPoints,
  ttftToSpeedPoints,
  type SpeedInput,
} from "./speed-score";

describe("tpsToSpeedPoints (absolute anchors)", () => {
  it("anchors land exactly", () => {
    expect(tpsToSpeedPoints(5)).toBe(40); // okay
    expect(tpsToSpeedPoints(15)).toBe(70); // good
    expect(tpsToSpeedPoints(30)).toBe(90); // fast
    expect(tpsToSpeedPoints(60)).toBe(100);
  });
  it("interpolates between anchors", () => {
    expect(tpsToSpeedPoints(10)).toBeCloseTo(55);
    expect(tpsToSpeedPoints(2.5)).toBeCloseTo(20);
  });
  it("saturates/clamps above 60", () => {
    expect(tpsToSpeedPoints(120)).toBe(100);
  });
  it("is monotonic non-decreasing", () => {
    let prev = -1;
    for (let t = 0.5; t <= 80; t += 0.5) {
      const v = tpsToSpeedPoints(t)!;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it("null / NaN / <=0 -> null", () => {
    expect(tpsToSpeedPoints(null)).toBeNull();
    expect(tpsToSpeedPoints(undefined)).toBeNull();
    expect(tpsToSpeedPoints(Number.NaN)).toBeNull();
    expect(tpsToSpeedPoints(-3)).toBeNull();
    expect(tpsToSpeedPoints(0)).toBeNull();
  });
});

describe("ttftToSpeedPoints (decreasing)", () => {
  it("anchors land exactly", () => {
    expect(ttftToSpeedPoints(300)).toBe(100);
    expect(ttftToSpeedPoints(800)).toBe(85);
    expect(ttftToSpeedPoints(2000)).toBe(60);
    expect(ttftToSpeedPoints(5000)).toBe(20);
    expect(ttftToSpeedPoints(10000)).toBe(0);
  });
  it("clamps: <=300 -> 100, >=10000 -> 0", () => {
    expect(ttftToSpeedPoints(150)).toBe(100);
    expect(ttftToSpeedPoints(99999)).toBe(0);
  });
  it("ttft <= 0 treated as missing -> null (not 100)", () => {
    expect(ttftToSpeedPoints(0)).toBeNull();
    expect(ttftToSpeedPoints(-5)).toBeNull();
    expect(ttftToSpeedPoints(null)).toBeNull();
  });
});

describe("speedScoreForRow (composite + renormalization)", () => {
  const row = (p: Partial<SpeedInput>): SpeedInput => ({
    model_id: "A",
    scenario: "chat_hello",
    ttft_ms: null,
    tps: null,
    ...p,
  });
  it("both present -> 0.7*tps + 0.3*ttft", () => {
    expect(speedScoreForRow(row({ tps: 15, ttft_ms: 2000 }))).toBeCloseTo(67);
  });
  it("ttft missing -> tps-only (not tps*0.7)", () => {
    expect(speedScoreForRow(row({ tps: 30, ttft_ms: null }))).toBeCloseTo(90);
  });
  it("tps missing -> ttft-only", () => {
    expect(speedScoreForRow(row({ tps: null, ttft_ms: 300 }))).toBeCloseTo(100);
  });
  it("both missing -> null", () => {
    expect(speedScoreForRow(row({}))).toBeNull();
  });
});

describe("computeSpeedScores (pool by model_id across scenarios + api)", () => {
  it("text/vision/total pooling; vision opt-out -> '—' + textOnly", () => {
    const m = computeSpeedScores([
      { model_id: "A", scenario: "chat_hello", tps: 30, ttft_ms: 300 }, // 93
      { model_id: "A", scenario: "code_sort_js", tps: 15, ttft_ms: 2000 }, // 67
    ]).get("A")!;
    expect(m.vision.score).toBeNull();
    expect(m.textOnly).toBe(true);
    expect(m.text.score).toBe(80); // round((93+67)/2)
    expect(m.total.score).toBe(80);
  });

  it("vision scenario routes to vision slice; total pools all", () => {
    const m = computeSpeedScores([
      { model_id: "A", scenario: "chat_hello", tps: 30, ttft_ms: 300 }, // 93
      { model_id: "A", scenario: "vision_table_ocr_a", tps: 5, ttft_ms: 5000 }, // 34
    ]).get("A")!;
    expect(m.vision.score).toBe(34);
    expect(m.textOnly).toBe(false);
    expect(m.total.score).toBe(64); // round((93+34)/2 = 63.5)
  });

  it("pools across api routes (2 rows, same scenario)", () => {
    const m = computeSpeedScores([
      { model_id: "A", scenario: "chat_hello", tps: 30, ttft_ms: 300 },
      { model_id: "A", scenario: "chat_hello", tps: 5, ttft_ms: 5000 },
    ]).get("A")!;
    expect(m.total.scoredRows).toBe(2);
  });

  it("approx tps flagged as caveat, still scored", () => {
    const m = computeSpeedScores([
      { model_id: "A", scenario: "chat_hello", tps: 15, ttft_ms: 2000, tps_source: "approx" },
    ]).get("A")!;
    expect(m.approxCaveat).toBe(true);
    expect(m.total.approxRows).toBe(1);
    expect(m.total.score).toBe(67);
  });

  it("both metrics missing -> row excluded (no score), still textOnly", () => {
    const m = computeSpeedScores([
      { model_id: "A", scenario: "chat_hello", tps: null, ttft_ms: null },
    ]).get("A")!;
    expect(m.total.score).toBeNull();
    expect(m.textOnly).toBe(true);
  });
});
