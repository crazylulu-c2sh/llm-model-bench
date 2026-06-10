import { describe, expect, it } from "vitest";
import {
  defaultMaxTokensForVisionScenario,
  getScenarioSystemPromptPreview,
  getScenarioUserPromptPreview,
  VISION_SCENARIO_IDS,
} from "./scenarios-preview.js";

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

describe("scenario prompt previews", () => {
  it("chat_hello user prompt is stable fixed text", () => {
    expect(getScenarioUserPromptPreview("chat_hello")).toContain("hello");
  });

  it("code_sort_js system prompt mentions fenced js block", () => {
    const sys = getScenarioSystemPromptPreview("code_sort_js");
    expect(sys).toContain("```js```");
    expect(sys).not.toMatch(/^\s*$/);
  });

  it("chat_time_calendar injects referenceIso and calendarTimeZone deterministically", () => {
    const ref = "2025-06-10T12:00:00.000Z";
    const user = getScenarioUserPromptPreview("chat_time_calendar", {
      referenceIso: ref,
      calendarTimeZone: "Asia/Seoul",
    });
    expect(user).toContain(ref);
    expect(user).toContain("Asia/Seoul");
    expect(getScenarioUserPromptPreview("chat_time_calendar", {
      referenceIso: ref,
      calendarTimeZone: "Asia/Seoul",
    })).toBe(user);
  });

  it("translate_nist_fips197_pdf_tools includes public asset origin when provided", () => {
    const user = getScenarioUserPromptPreview("translate_nist_fips197_pdf_tools", {
      publicAssetBaseUrl: "http://127.0.0.1:21104",
    });
    expect(user).toContain("http://127.0.0.1:21104");
    expect(user).toContain("nist.fips.197.pdf");
  });
});
