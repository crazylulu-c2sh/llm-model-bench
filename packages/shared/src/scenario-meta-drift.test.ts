import { describe, expect, it } from "vitest";
import { getScenarioBenchMeta, type BenchLocale } from "./scenario-meta/index.js";
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

// 정답 수치·식별자는 로케일과 무관하게 모든 언어의 criteria에 나타나야 한다(번역이 GT를 보존하도록 강제).
const LOCALES: readonly BenchLocale[] = ["ko", "en", "ja"];
const crit = (id: string, locale: BenchLocale): string => getScenarioBenchMeta(id, locale)!.criteria;

describe("scenario-meta drift guard — GT 수치·식별자(전 로케일)", () => {
  it("OCR 시나리오는 기대 수치 정답을 포함", () => {
    for (const locale of LOCALES)
      for (const id of ["vision_table_ocr_a", "vision_table_ocr_b"] as const) {
        const gt = VISION_SCORING_GROUND_TRUTH[id];
        const meta = getScenarioBenchMeta(id, locale);
        expect(meta).not.toBeNull();
        expect(meta!.criteria).toContain(String(gt.net_income_2024));
        expect(meta!.criteria).toContain(String(gt.net_income_yoy_percent));
      }
  });

  it("카운팅 시나리오는 기대 범위를 포함", () => {
    for (const locale of LOCALES)
      for (const id of ["vision_count_red_cars_a", "vision_count_red_cars_b"] as const) {
        const gt = VISION_SCORING_GROUND_TRUTH[id];
        expect(crit(id, locale)).toContain(`${gt.range[0]}~${gt.range[1]}`);
      }
  });

  it("차트 시나리오는 product·quarter·value_percent를 포함", () => {
    for (const locale of LOCALES)
      for (const id of ["vision_chart_peak_a", "vision_chart_peak_b"] as const) {
        const gt = VISION_SCORING_GROUND_TRUTH[id];
        const c = crit(id, locale);
        expect(c).toContain(gt.product);
        expect(c).toContain(gt.quarter);
        expect(c).toContain(String(gt.value_percent));
      }
  });

  it("wireframe 시나리오는 필수 단서 문자열을 포함(대소문자 무시)", () => {
    for (const locale of LOCALES)
      for (const id of ["vision_wireframe_html_a", "vision_wireframe_html_b"] as const) {
        const gt = VISION_SCORING_GROUND_TRUTH[id];
        const lower = crit(id, locale).toLowerCase();
        for (const cue of gt.cues) expect(lower).toContain(cue);
      }
  });

  it("OCR 허용오차 수치를 포함", () => {
    for (const locale of LOCALES)
      for (const id of ["vision_table_ocr_a", "vision_table_ocr_b"] as const) {
        const c = crit(id, locale);
        expect(c).toContain(`${OCR_VALUE_REL_TOL * 100}%`);
        expect(c).toContain(`${OCR_YOY_ABS_TOL}`);
      }
  });

  it("카운팅 허용오차·환각 상한 수치를 포함", () => {
    for (const locale of LOCALES)
      for (const id of ["vision_count_red_cars_a", "vision_count_red_cars_b"] as const) {
        const c = crit(id, locale);
        expect(c).toContain(`${COUNT_RED_CARS_TOL_NEAR}`);
        expect(c).toContain(`${COUNT_RED_CARS_TOL_FAR}`);
        expect(c).toContain(`${COUNT_RED_CARS_MAX_PLAUSIBLE}`);
      }
  });

  it("차트 value 허용오차 수치를 포함", () => {
    for (const locale of LOCALES)
      for (const id of ["vision_chart_peak_a", "vision_chart_peak_b"] as const) {
        expect(crit(id, locale)).toContain(`${CHART_VALUE_ABS_TOL}`);
      }
  });

  const judgeIds = [
    "vision_meme_explain_a",
    "vision_meme_explain_b",
    "vision_wireframe_html_a",
    "vision_wireframe_html_b",
  ] as const;

  it("judge 시나리오는 모델·timeout·재시도·실패 라벨을 문서화", () => {
    for (const locale of LOCALES)
      for (const id of judgeIds) {
        const c = crit(id, locale);
        expect(c).toContain(DEFAULT_LLM_JUDGE_MODEL);
        expect(c).toContain(`${LLM_JUDGE_TIMEOUT_MS / 1000}`);
        expect(c).toContain(`${LLM_JUDGE_MAX_RETRIES}`);
        for (const label of JUDGE_FAILURE_LABELS) expect(c).toContain(label);
      }
  });

  it("meme criteria는 모든 prefilter 단서를 나열(백틱 표기 유지)", () => {
    for (const locale of LOCALES)
      for (const id of ["vision_meme_explain_a", "vision_meme_explain_b"] as const) {
        const c = crit(id, locale);
        for (const cue of [
          ...MEME_PREFILTER_CUES.server,
          ...MEME_PREFILTER_CUES.donkey,
          ...MEME_PREFILTER_CUES.contrast,
        ]) {
          expect(c).toContain(`\`${cue}\``);
        }
      }
  });

  it("wireframe criteria는 최소 시맨틱 태그 수를 문서화", () => {
    for (const locale of LOCALES)
      for (const id of ["vision_wireframe_html_a", "vision_wireframe_html_b"] as const) {
        expect(crit(id, locale)).toContain(`${WIREFRAME_MIN_SEMANTIC_TAGS}`);
      }
  });

  it("chat_time_calendar는 러너 고정 타임존을 문서화", () => {
    for (const locale of LOCALES)
      expect(crit("chat_time_calendar", locale)).toContain(DEFAULT_CALENDAR_TIMEZONE);
  });
});

// 한국어 특정 표현(상대오차/절대오차/대/개 이상 등)은 ko 원문에서만 검증.
describe("scenario-meta drift guard — ko 원문 표현", () => {
  it("OCR criteria(ko)는 상대/절대 오차 표현을 포함", () => {
    for (const id of ["vision_table_ocr_a", "vision_table_ocr_b"] as const) {
      const c = crit(id, "ko");
      expect(c).toContain(`${OCR_VALUE_REL_TOL * 100}% 상대오차`);
      expect(c).toContain(`${OCR_YOY_ABS_TOL}%p 절대오차`);
    }
  });

  it("카운팅 criteria(ko)는 근/원 허용오차·환각 표현을 포함", () => {
    for (const id of ["vision_count_red_cars_a", "vision_count_red_cars_b"] as const) {
      const c = crit(id, "ko");
      expect(c).toContain(`±${COUNT_RED_CARS_TOL_NEAR}대`);
      expect(c).toContain(`±${COUNT_RED_CARS_TOL_FAR}대`);
      expect(c).toContain(`${COUNT_RED_CARS_MAX_PLAUSIBLE} 이상 환각`);
    }
  });

  it("차트 criteria(ko)는 value 허용오차 표현을 포함", () => {
    for (const id of ["vision_chart_peak_a", "vision_chart_peak_b"] as const) {
      expect(crit(id, "ko")).toContain(`±${CHART_VALUE_ABS_TOL}%p`);
    }
  });

  it("judge criteria(ko)는 timeout/재시도 표현을 포함", () => {
    for (const id of ["vision_meme_explain_a", "vision_wireframe_html_a"] as const) {
      const c = crit(id, "ko");
      expect(c).toContain(`timeout ${LLM_JUDGE_TIMEOUT_MS / 1000}s`);
      expect(c).toContain(`재시도 ${LLM_JUDGE_MAX_RETRIES}회`);
    }
  });

  it("wireframe criteria(ko)는 최소 시맨틱 태그 표현을 포함", () => {
    for (const id of ["vision_wireframe_html_a", "vision_wireframe_html_b"] as const) {
      expect(crit(id, "ko")).toContain(`중 ${WIREFRAME_MIN_SEMANTIC_TAGS}개 이상`);
    }
  });
});
