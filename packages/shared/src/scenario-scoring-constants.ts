/** 비전 시나리오 채점 ground truth — 서버 `scoreScenario`·문서 META drift 테스트 단일 소스. */
export const VISION_SCORING_GROUND_TRUTH = {
  vision_table_ocr_a: { net_income_2024: 2373.9, net_income_yoy_percent: 11.3 },
  vision_table_ocr_b: { net_income_2024: 410.55, net_income_yoy_percent: 20.7 },
  vision_count_red_cars_a: { range: [31, 37] as const },
  vision_count_red_cars_b: { range: [40, 48] as const },
  vision_chart_peak_a: { product: "C", quarter: "Q2 2024", value_percent: 45.8 },
  vision_chart_peak_b: { product: "C", quarter: "Q2 2024", value_percent: 62.4 },
  vision_wireframe_html_a: { cues: ["sign up", "learn more", "feature"] as const },
  vision_wireframe_html_b: { cues: ["get started", "learn more", "feature title"] as const },
} as const;

export type VisionScoringGroundTruthId = keyof typeof VISION_SCORING_GROUND_TRUTH;

export const OCR_VALUE_REL_TOL = 0.02;
export const OCR_YOY_ABS_TOL = 0.5;
export const CHART_VALUE_ABS_TOL = 1.5;
export const COUNT_RED_CARS_TOL_NEAR = 3;
export const COUNT_RED_CARS_TOL_FAR = 5;
