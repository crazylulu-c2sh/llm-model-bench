import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCENARIO_IDS,
  defaultMaxTokensForVisionScenario,
  getScenarioSystemPromptPreview,
  getScenarioUserPromptPreview,
  isAgentScenario,
  isVisionScenario,
  scenarioCategory,
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

describe("scenarioCategory / isAgentScenario", () => {
  it("agent_* → 'agent' 카테고리", () => {
    expect(scenarioCategory("agent_loop_mock_v1")).toBe("agent");
    expect(scenarioCategory("agent_loop_budget_v1")).toBe("agent");
    expect(isAgentScenario("agent_loop_mock_v1")).toBe(true);
    expect(isAgentScenario("agent_anything")).toBe(true);
  });

  it("vision_* → 'vision', 나머지 → 'text' (agent 아님)", () => {
    expect(scenarioCategory("vision_table_ocr_a")).toBe("vision");
    expect(scenarioCategory("chat_hello")).toBe("text");
    expect(scenarioCategory("code_sort_js")).toBe("text");
    expect(isAgentScenario("vision_table_ocr_a")).toBe(false);
    expect(isAgentScenario("chat_hello")).toBe(false);
    // vision·agent는 상호배타
    for (const id of VISION_SCENARIO_IDS) expect(isAgentScenario(id)).toBe(false);
  });

  it("불변식: 기본 세트(DEFAULT_SCENARIO_IDS)에는 에이전트·비전 시나리오가 없다 — 기본 런 무변화", () => {
    for (const id of DEFAULT_SCENARIO_IDS) {
      expect(isAgentScenario(id)).toBe(false);
      expect(isVisionScenario(id)).toBe(false);
      expect(scenarioCategory(id)).toBe("text");
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

  it("chat_time_calendar injects Seoul date and calendarTimeZone deterministically", () => {
    const ref = "2025-06-10T12:00:00.000Z";
    // 2025-06-10T12:00Z + 9h = 2025-06-10T21:00 Seoul → 당일
    const user = getScenarioUserPromptPreview("chat_time_calendar", {
      referenceIso: ref,
      calendarTimeZone: "Asia/Seoul",
    });
    expect(user).toContain("2025-06-10");
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
    expect(user).not.toContain("fetch_pdf_text");
    expect(user).not.toMatch(/1\)/);
    const sys = getScenarioSystemPromptPreview("translate_nist_fips197_pdf_tools");
    expect(sys).toContain("fetch_pdf_text");
    expect(sys).toContain("1000");
  });

  it("structured_action: schema in system, quarterly report task in user", () => {
    const sys = getScenarioSystemPromptPreview("structured_action");
    const user = getScenarioUserPromptPreview("structured_action");
    expect(sys).toContain('"action"');
    expect(sys).toContain("confidence");
    expect(user).toContain("quarterly report");
    expect(user).not.toContain('{"action":"string"');
  });

  it("code_sort_js: format rules in system only, quicksort task in user", () => {
    const sys = getScenarioSystemPromptPreview("code_sort_js");
    const user = getScenarioUserPromptPreview("code_sort_js");
    expect(sys).toContain("```js```");
    expect(user).toContain("quicksort");
    expect(user).not.toMatch(/Output ONLY/i);
    expect(user).not.toContain("fenced");
  });

  it("code_sort_py: format rules in system only, quicksort task in user", () => {
    const sys = getScenarioSystemPromptPreview("code_sort_py");
    const user = getScenarioUserPromptPreview("code_sort_py");
    expect(sys).toContain("```python```");
    expect(user).toContain("quicksort");
    expect(user).not.toMatch(/Output ONLY/i);
  });

  it("vision_meme_explain: style in system, satire/panel task in user", () => {
    const sys = getScenarioSystemPromptPreview("vision_meme_explain_a");
    const user = getScenarioUserPromptPreview("vision_meme_explain_a");
    expect(sys).toMatch(/3.5/);
    expect(sys).toContain("sentences");
    expect(user).toContain("풍자");
    expect(user).toContain("패널");
    expect(user).not.toMatch(/3.5/);
    expect(user).not.toContain("sentences");
  });

  it("vision_wireframe_html: format in system, recreation task in user", () => {
    const sys = getScenarioSystemPromptPreview("vision_wireframe_html_a");
    const user = getScenarioUserPromptPreview("vision_wireframe_html_a");
    expect(sys).toContain("```html```");
    expect(sys).toContain("Tailwind");
    expect(user).toContain("wireframe");
    expect(user).toContain("labels");
    expect(user).not.toMatch(/fenced/i);
    expect(user).not.toMatch(/no prose/i);
  });
});
