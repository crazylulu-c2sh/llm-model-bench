import { describe, expect, it } from "vitest";
import { defaultMaxTokensForVisionScenario, VISION_SCENARIO_IDS } from "./scenarios-preview.js";

describe("defaultMaxTokensForVisionScenario", () => {
  it("chart / OCR / counting scenarios → 2048 (reasoning headroom)", () => {
    expect(defaultMaxTokensForVisionScenario("vision_chart_peak_a")).toBe(2048);
    expect(defaultMaxTokensForVisionScenario("vision_chart_peak_b")).toBe(2048);
    expect(defaultMaxTokensForVisionScenario("vision_table_ocr_a")).toBe(2048);
    expect(defaultMaxTokensForVisionScenario("vision_table_ocr_b")).toBe(2048);
    expect(defaultMaxTokensForVisionScenario("vision_count_red_cars_a")).toBe(2048);
    expect(defaultMaxTokensForVisionScenario("vision_count_red_cars_b")).toBe(2048);
  });

  it("meme scenarios → 1024 (subjective short prose)", () => {
    expect(defaultMaxTokensForVisionScenario("vision_meme_explain_a")).toBe(1024);
    expect(defaultMaxTokensForVisionScenario("vision_meme_explain_b")).toBe(1024);
  });

  it("wireframe scenarios → 4096 (long HTML output)", () => {
    expect(defaultMaxTokensForVisionScenario("vision_wireframe_html_a")).toBe(4096);
    expect(defaultMaxTokensForVisionScenario("vision_wireframe_html_b")).toBe(4096);
  });

  it("text scenarios → null (no vision-specific override)", () => {
    expect(defaultMaxTokensForVisionScenario("chat_ping")).toBeNull();
    expect(defaultMaxTokensForVisionScenario("structured_action")).toBeNull();
    expect(defaultMaxTokensForVisionScenario("unknown_id")).toBeNull();
  });

  it("VISION_SCENARIO_IDS는 모든 비전 시나리오를 망라하고 텍스트 시나리오는 포함하지 않음", () => {
    for (const id of VISION_SCENARIO_IDS) {
      expect(defaultMaxTokensForVisionScenario(id)).not.toBeNull();
    }
  });
});
