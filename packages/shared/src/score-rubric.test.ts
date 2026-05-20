import { describe, expect, it } from "vitest";
import { rubricToScore, scoreToRubric } from "./scenarios-preview.js";

describe("scoreToRubric (inverse of rubricToScore)", () => {
  it("round-trips all 4 canonical values", () => {
    for (const n of [0, 1, 2, 3] as const) {
      const { score } = rubricToScore(n);
      expect(scoreToRubric(score)).toBe(n);
    }
  });

  it("absorbs ±0.02 floating-point noise", () => {
    expect(scoreToRubric(0.67)).toBe(2);
    expect(scoreToRubric(0.67 - 0.005)).toBe(2);
    expect(scoreToRubric(0.67 + 0.005)).toBe(2);
    expect(scoreToRubric(0.33)).toBe(1);
    expect(scoreToRubric(0.34)).toBe(1);
    expect(scoreToRubric(0.32)).toBe(1);
  });

  it("returns null for null / NaN / undefined", () => {
    expect(scoreToRubric(null)).toBeNull();
    expect(scoreToRubric(undefined)).toBeNull();
    expect(scoreToRubric(Number.NaN)).toBeNull();
  });

  it("returns null for out-of-range scores", () => {
    expect(scoreToRubric(-0.1)).toBeNull();
    expect(scoreToRubric(1.5)).toBeNull();
  });

  it("returns null for non-canonical mid-band values (> 0.05 from any rubric step)", () => {
    expect(scoreToRubric(0.5)).toBeNull();
    expect(scoreToRubric(0.85)).toBeNull();
  });
});
