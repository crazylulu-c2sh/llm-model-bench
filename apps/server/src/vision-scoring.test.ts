import { describe, expect, it } from "vitest";
import { scoreScenario } from "./scenarios.js";

describe("scoreScenario vision_table_ocr_a", () => {
  it("returns rubric 3 when both keys match", () => {
    const out = JSON.stringify({ net_income_2024: 2373.9, net_income_yoy_percent: 11.3 });
    const r = scoreScenario("vision_table_ocr_a", out);
    expect(r.pass).toBe(true);
    expect(r.score).toBeCloseTo(1, 5);
  });

  it("accepts $/comma-formatted strings", () => {
    const out = '{"net_income_2024":"$2,373.9","net_income_yoy_percent":"+11.3%"}';
    const r = scoreScenario("vision_table_ocr_a", out);
    expect(r.pass).toBe(true);
  });

  it("returns rubric 2 when only one key is within tolerance", () => {
    const out = JSON.stringify({ net_income_2024: 2373.9, net_income_yoy_percent: 99.9 });
    const r = scoreScenario("vision_table_ocr_a", out);
    expect(r.score).toBeCloseTo(0.67, 2);
  });

  it("returns rubric 1 when both off but parsable", () => {
    const out = JSON.stringify({ net_income_2024: 99999, net_income_yoy_percent: 99.9 });
    const r = scoreScenario("vision_table_ocr_a", out);
    expect(r.score).toBeCloseTo(0.33, 2);
  });

  it("returns rubric 0 on missing JSON", () => {
    const r = scoreScenario("vision_table_ocr_a", "I cannot read this");
    expect(r.pass).toBe(false);
    expect(r.score).toBe(0);
  });
});

describe("scoreScenario vision_count_red_cars_a (range [31, 37])", () => {
  it("rubric 3 inside the range", () => {
    expect(scoreScenario("vision_count_red_cars_a", '{"red_cars":34}').pass).toBe(true);
    expect(scoreScenario("vision_count_red_cars_a", '{"red_cars":31}').pass).toBe(true);
    expect(scoreScenario("vision_count_red_cars_a", '{"red_cars":37}').pass).toBe(true);
  });

  it("rubric 2 within ±3 of the range", () => {
    const r = scoreScenario("vision_count_red_cars_a", '{"red_cars":40}');
    expect(r.score).toBeCloseTo(0.67, 2);
  });

  it("rubric 1 within ±5", () => {
    const r = scoreScenario("vision_count_red_cars_a", '{"red_cars":42}');
    expect(r.score).toBeCloseTo(0.33, 2);
  });

  it("rubric 0 outside ±5", () => {
    expect(scoreScenario("vision_count_red_cars_a", '{"red_cars":15}').score).toBe(0);
  });

  it("rubric 0 on explicit 0", () => {
    expect(scoreScenario("vision_count_red_cars_a", '{"red_cars":0}').score).toBe(0);
  });

  it("rubric 0 on excessive hallucination (>=100)", () => {
    expect(scoreScenario("vision_count_red_cars_a", '{"red_cars":200}').score).toBe(0);
  });

  it("rubric 0 when JSON key missing", () => {
    expect(scoreScenario("vision_count_red_cars_a", "approximately 34 red cars").score).toBe(0);
  });
});

describe("scoreScenario vision_chart_peak_a", () => {
  it("rubric 3 when all three match (with normalization)", () => {
    const out = '{"product":"c","quarter":"Q2\'24","value_percent":"45.8%"}';
    const r = scoreScenario("vision_chart_peak_a", out);
    expect(r.pass).toBe(true);
    expect(r.score).toBeCloseTo(1, 5);
  });

  it("rubric 2 when two of three match", () => {
    const out = JSON.stringify({ product: "C", quarter: "Q2 2024", value_percent: 99.9 });
    const r = scoreScenario("vision_chart_peak_a", out);
    expect(r.score).toBeCloseTo(0.67, 2);
  });

  it("rubric 0 on JSON parse failure", () => {
    expect(scoreScenario("vision_chart_peak_a", "broken").score).toBe(0);
  });
});

describe("scoreScenario vision_meme_explain_a (prefilter only — judge disabled in tests)", () => {
  it("rubric 1 when all four prefilter keywords present", () => {
    const out =
      "이 밈은 데이터센터 서버 랙과 당나귀 수레의 대비로 기대와 현실의 차이를 풍자합니다.";
    const r = scoreScenario("vision_meme_explain_a", out);
    expect(r.score).toBeCloseTo(0.33, 2);
    expect(r.reason).toMatch(/judge_pending/);
  });

  it("rubric 0 when Korean keywords missing", () => {
    expect(scoreScenario("vision_meme_explain_a", "server rack vs donkey cart").score).toBe(0);
  });
});

describe("scoreScenario vision_wireframe_html_a", () => {
  it("rubric 1 when prefilter passes (case-insensitive substring)", () => {
    const html = `
      \`\`\`html
      <header><nav>Sign Up</nav></header>
      <main><section>FEATURE 1 <a>Learn more</a></section></main>
      <footer></footer>
      \`\`\`
    `;
    const r = scoreScenario("vision_wireframe_html_a", html);
    expect(r.score).toBeCloseTo(0.33, 2);
    expect(r.reason).toMatch(/judge_pending/);
  });

  it("rubric 0 when semantic tags missing", () => {
    const out = "```html\n<div>Sign Up Learn More Feature</div>\n```";
    const r = scoreScenario("vision_wireframe_html_a", out);
    expect(r.score).toBe(0);
  });

  it("rubric 0 when cues missing", () => {
    const out = "```html\n<header></header><nav></nav><main></main><footer></footer>\n```";
    const r = scoreScenario("vision_wireframe_html_a", out);
    expect(r.score).toBe(0);
  });
});
