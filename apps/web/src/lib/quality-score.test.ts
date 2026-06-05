import { describe, expect, it } from "vitest";
import { computeQualityScores, type QualityInput } from "./quality-score";

function q(p: Partial<QualityInput> & { model_id: string; scenario: string }): QualityInput {
  return { score: undefined, ...p };
}

describe("computeQualityScores", () => {
  it("text-only pass rate; vision N/A; total = text-only", () => {
    const rows: QualityInput[] = [
      q({ model_id: "A", scenario: "chat_hello", score: 1 }),
      q({ model_id: "A", scenario: "chat_ping", score: 1 }),
      q({ model_id: "A", scenario: "chat_time_calendar", score: 1 }),
      q({ model_id: "A", scenario: "tool_weather", score: 0 }),
      q({ model_id: "A", scenario: "structured_action", score: 1 }),
      q({ model_id: "A", scenario: "code_sort_js", score: 1 }),
      q({ model_id: "A", scenario: "code_sort_py", score: 1 }),
      q({ model_id: "A", scenario: "translate_nist_fips197_pdf_tools", score: 1 }),
    ];
    const [m] = computeQualityScores(rows);
    expect(m!.text.value).toBe(87.5); // 7/8
    expect(m!.text.covered).toBe(8);
    expect(m!.text.expected).toBe(8);
    expect(m!.vision.value).toBeNull();
    expect(m!.total.value).toBe(87.5);
    expect(m!.textOnly).toBe(true);
  });

  it("pooled total ≠ avg(text, vision)", () => {
    const rows = [
      q({ model_id: "A", scenario: "chat_hello", score: 1 }),
      q({ model_id: "A", scenario: "chat_ping", score: 1 }),
      q({ model_id: "A", scenario: "vision_table_ocr_a", score: 0 }),
      q({ model_id: "A", scenario: "vision_table_ocr_b", score: 0 }),
      q({ model_id: "A", scenario: "vision_count_red_cars_a", score: 0 }),
      q({ model_id: "A", scenario: "vision_count_red_cars_b", score: 0 }),
    ];
    const [m] = computeQualityScores(rows);
    expect(m!.text.value).toBe(100);
    expect(m!.vision.value).toBe(0);
    expect(m!.total.value).toBeCloseTo((2 / 6) * 100); // 33.33, not 50
    expect(m!.textOnly).toBe(false);
  });

  it("vision rubric scores average", () => {
    const rows = [
      q({ model_id: "A", scenario: "vision_table_ocr_a", score: 1 }),
      q({ model_id: "A", scenario: "vision_table_ocr_b", score: 0.67 }),
      q({ model_id: "A", scenario: "vision_count_red_cars_a", score: 0.33 }),
      q({ model_id: "A", scenario: "vision_count_red_cars_b", score: 0 }),
    ];
    const [m] = computeQualityScores(rows);
    expect(m!.vision.value).toBeCloseTo(50);
    expect(m!.vision.covered).toBe(4);
  });

  it("undefined score excluded (not zero); coverage flags (2/3)", () => {
    const rows = [
      q({ model_id: "A", scenario: "chat_hello", score: 1 }),
      q({ model_id: "A", scenario: "chat_ping", score: undefined }),
      q({ model_id: "A", scenario: "tool_weather", score: 1 }),
    ];
    const [m] = computeQualityScores(rows);
    expect(m!.text.value).toBe(100); // mean of the two finite 1s
    expect(m!.text.covered).toBe(2);
    expect(m!.text.expected).toBe(3);
  });

  it("score 0 (failure) IS counted", () => {
    const rows = [
      q({ model_id: "A", scenario: "chat_hello", score: 1 }),
      q({ model_id: "A", scenario: "chat_ping", score: 0 }),
    ];
    const [m] = computeQualityScores(rows);
    expect(m!.text.value).toBe(50);
    expect(m!.text.covered).toBe(2);
  });

  it("all-undefined group → null value, expected>0, no_quality_data caveat", () => {
    const rows = [
      q({ model_id: "A", scenario: "chat_hello" }),
      q({ model_id: "A", scenario: "chat_ping" }),
    ];
    const [m] = computeQualityScores(rows);
    expect(m!.text.value).toBeNull();
    expect(m!.text.expected).toBe(2);
    expect(m!.caveats).toContain("no_quality_data");
  });

  it("multi-route pooling: distinct-scenario coverage (1 scenario, 2 rows)", () => {
    const rows = [
      q({ model_id: "A", scenario: "chat_hello", score: 1 }),
      q({ model_id: "A", scenario: "chat_hello", score: 0 }),
    ];
    const [m] = computeQualityScores(rows);
    expect(m!.text.value).toBe(50); // row-weighted mean
    expect(m!.text.covered).toBe(1); // distinct scenario
    expect(m!.text.expected).toBe(1);
  });

  it("judge_capped caveat surfaced; capped score still in mean", () => {
    const rows = [
      q({ model_id: "A", scenario: "vision_meme_explain_a", score: 0.33, judgeCapped: true }),
      q({ model_id: "A", scenario: "vision_meme_explain_b", score: 1 }),
    ];
    const [m] = computeQualityScores(rows);
    expect(m!.caveats).toContain("judge_capped");
    expect(m!.judgeCappedScenarios).toBe(1);
    expect(m!.vision.value).toBeCloseTo(66.5);
  });

  it("vision_partial when some vision scenarios unscored", () => {
    const rows = [
      q({ model_id: "A", scenario: "vision_table_ocr_a", score: 1 }),
      q({ model_id: "A", scenario: "vision_table_ocr_b", score: undefined }),
    ];
    const [m] = computeQualityScores(rows);
    expect(m!.vision.covered).toBe(1);
    expect(m!.vision.expected).toBe(2);
    expect(m!.caveats).toContain("vision_partial");
  });

  it("preserves first-seen model order", () => {
    const rows = [
      q({ model_id: "B", scenario: "chat_hello", score: 1 }),
      q({ model_id: "A", scenario: "chat_hello", score: 1 }),
    ];
    const ms = computeQualityScores(rows);
    expect(ms.map((m) => m.model_id)).toEqual(["B", "A"]);
  });
});
