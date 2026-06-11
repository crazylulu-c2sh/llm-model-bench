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
/** red_cars가 이 값 이상이면 환각으로 간주해 rubric 0. */
export const COUNT_RED_CARS_MAX_PLAUSIBLE = 100;

/** `chat_time_calendar` 기본 타임존 — 러너·채점·프리뷰·문서 META 단일 소스. */
export const DEFAULT_CALENDAR_TIMEZONE = "Asia/Seoul";

/** meme prefilter 단서 — 서버 채점 정규식·문서 META 프로즈 공통 조립 소스. */
export const MEME_PREFILTER_CUES = {
  server: ["서버", "데이터센터", "랙", "server", "datacenter", "data center"],
  donkey: ["당나귀", "수레", "짐마차", "donkey", "cart"],
  contrast: [
    "대비",
    "차이",
    "기대",
    "현실",
    "약속",
    "실제",
    "promise",
    "reality",
    "expect",
    "expectation",
  ],
} as const;

/** 단서 배열 → case-insensitive alternation 정규식 소스 (서버 채점기·테스트 공통). */
export function cueAlternationSource(cues: readonly string[]): string {
  return cues.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

/** wireframe prefilter — 시맨틱 태그 후보와 최소 개수 (서버 채점·문서 META 공통). */
export const WIREFRAME_SEMANTIC_TAGS = ["<header", "<nav", "<main", "<section", "<footer"] as const;
export const WIREFRAME_MIN_SEMANTIC_TAGS = 3;

/** LLM judge 운영 스펙 — 서버 `judge.ts`·문서 META 프로즈 단일 소스. */
export const DEFAULT_LLM_JUDGE_MODEL = "claude-opus-4-7";
export const LLM_JUDGE_TIMEOUT_MS = 30_000;
export const LLM_JUDGE_MAX_RETRIES = 0;
export const JUDGE_FAILURE_LABELS = [
  "judge_timeout",
  "judge_parse_error",
  "judge_network_error",
] as const;
