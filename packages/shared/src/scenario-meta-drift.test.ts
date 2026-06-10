import { describe, expect, it } from "vitest";
import { getScenarioBenchMeta } from "./scenario-meta.js";
import { VISION_SCORING_GROUND_TRUTH } from "./scenario-scoring-constants.js";

describe("scenario-meta drift guard (ground truth ↔ criteriaKo)", () => {
  it("OCR scenarios include expected numeric answers", () => {
    for (const id of ["vision_table_ocr_a", "vision_table_ocr_b"] as const) {
      const gt = VISION_SCORING_GROUND_TRUTH[id];
      const meta = getScenarioBenchMeta(id);
      expect(meta).not.toBeNull();
      expect(meta!.criteriaKo).toContain(String(gt.net_income_2024));
      expect(meta!.criteriaKo).toContain(String(gt.net_income_yoy_percent));
    }
  });

  it("counting scenarios include expected ranges", () => {
    for (const id of ["vision_count_red_cars_a", "vision_count_red_cars_b"] as const) {
      const gt = VISION_SCORING_GROUND_TRUTH[id];
      const meta = getScenarioBenchMeta(id);
      expect(meta).not.toBeNull();
      expect(meta!.criteriaKo).toContain(`${gt.range[0]}~${gt.range[1]}`);
    }
  });

  it("chart scenarios include product, quarter, and value_percent", () => {
    for (const id of ["vision_chart_peak_a", "vision_chart_peak_b"] as const) {
      const gt = VISION_SCORING_GROUND_TRUTH[id];
      const meta = getScenarioBenchMeta(id);
      expect(meta).not.toBeNull();
      expect(meta!.criteriaKo).toContain(gt.product);
      expect(meta!.criteriaKo).toContain(gt.quarter);
      expect(meta!.criteriaKo).toContain(String(gt.value_percent));
    }
  });

  it("wireframe scenarios include required cue strings (case-insensitive)", () => {
    for (const id of ["vision_wireframe_html_a", "vision_wireframe_html_b"] as const) {
      const gt = VISION_SCORING_GROUND_TRUTH[id];
      const meta = getScenarioBenchMeta(id);
      expect(meta).not.toBeNull();
      const lower = meta!.criteriaKo.toLowerCase();
      for (const cue of gt.cues) {
        expect(lower).toContain(cue);
      }
    }
  });
});
