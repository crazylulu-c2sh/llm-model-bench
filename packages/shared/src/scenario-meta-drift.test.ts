import { describe, expect, it } from "vitest";
import { getScenarioBenchMeta } from "./scenario-meta.js";
import {
  CHART_VALUE_ABS_TOL,
  COUNT_RED_CARS_MAX_PLAUSIBLE,
  COUNT_RED_CARS_TOL_FAR,
  COUNT_RED_CARS_TOL_NEAR,
  DEFAULT_CALENDAR_TIMEZONE,
  DEFAULT_LLM_JUDGE_MODEL,
  JUDGE_FAILURE_LABELS,
  LLM_JUDGE_MAX_RETRIES,
  LLM_JUDGE_TIMEOUT_MS,
  MEME_PREFILTER_CUES,
  OCR_VALUE_REL_TOL,
  OCR_YOY_ABS_TOL,
  VISION_SCORING_GROUND_TRUTH,
  WIREFRAME_MIN_SEMANTIC_TAGS,
} from "./scenario-scoring-constants.js";

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

describe("scenario-meta drift guard (tolerances ↔ criteriaKo)", () => {
  it("OCR criteria include relative/absolute tolerances", () => {
    for (const id of ["vision_table_ocr_a", "vision_table_ocr_b"] as const) {
      const c = getScenarioBenchMeta(id)!.criteriaKo;
      expect(c).toContain(`${OCR_VALUE_REL_TOL * 100}% 상대오차`);
      expect(c).toContain(`${OCR_YOY_ABS_TOL}%p 절대오차`);
    }
  });

  it("counting criteria include near/far tolerances and hallucination cap", () => {
    for (const id of ["vision_count_red_cars_a", "vision_count_red_cars_b"] as const) {
      const c = getScenarioBenchMeta(id)!.criteriaKo;
      expect(c).toContain(`±${COUNT_RED_CARS_TOL_NEAR}대`);
      expect(c).toContain(`±${COUNT_RED_CARS_TOL_FAR}대`);
      expect(c).toContain(`${COUNT_RED_CARS_MAX_PLAUSIBLE} 이상 환각`);
    }
  });

  it("chart criteria include value tolerance", () => {
    for (const id of ["vision_chart_peak_a", "vision_chart_peak_b"] as const) {
      expect(getScenarioBenchMeta(id)!.criteriaKo).toContain(`±${CHART_VALUE_ABS_TOL}%p`);
    }
  });
});

describe("scenario-meta drift guard (judge ops ↔ criteriaKo)", () => {
  const judgeIds = [
    "vision_meme_explain_a",
    "vision_meme_explain_b",
    "vision_wireframe_html_a",
    "vision_wireframe_html_b",
  ] as const;

  it("judge scenarios document model, timeout, retries, and failure labels", () => {
    for (const id of judgeIds) {
      const c = getScenarioBenchMeta(id)!.criteriaKo;
      expect(c).toContain(DEFAULT_LLM_JUDGE_MODEL);
      expect(c).toContain(`timeout ${LLM_JUDGE_TIMEOUT_MS / 1000}s`);
      expect(c).toContain(`재시도 ${LLM_JUDGE_MAX_RETRIES}회`);
      for (const label of JUDGE_FAILURE_LABELS) {
        expect(c).toContain(label);
      }
    }
  });

  it("meme criteria list every prefilter cue", () => {
    for (const id of ["vision_meme_explain_a", "vision_meme_explain_b"] as const) {
      const c = getScenarioBenchMeta(id)!.criteriaKo;
      for (const cue of [
        ...MEME_PREFILTER_CUES.server,
        ...MEME_PREFILTER_CUES.donkey,
        ...MEME_PREFILTER_CUES.contrast,
      ]) {
        expect(c).toContain(`\`${cue}\``);
      }
    }
  });

  it("wireframe criteria document the minimum semantic tag count", () => {
    for (const id of ["vision_wireframe_html_a", "vision_wireframe_html_b"] as const) {
      expect(getScenarioBenchMeta(id)!.criteriaKo).toContain(
        `중 ${WIREFRAME_MIN_SEMANTIC_TAGS}개 이상`,
      );
    }
  });
});

describe("scenario-meta drift guard (calendar timezone)", () => {
  it("chat_time_calendar documents the runner-fixed timezone", () => {
    expect(getScenarioBenchMeta("chat_time_calendar")!.criteriaKo).toContain(
      DEFAULT_CALENDAR_TIMEZONE,
    );
  });
});
