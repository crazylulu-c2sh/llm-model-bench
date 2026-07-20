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

// ─── #105: 에이전트 시나리오 결정론 채점 ground truth ──────────────────────────
// mock 도구가 캔드 응답을 주므로 "모델이 볼 수 있었던 사실"의 전집합이 우리 손에 있다 →
// LLM judge 없이 rubric 0~3 을 산출할 수 있다. 아래 상수와 `agent-loop-builtin.ts` 의 실제
// mock 문자열이 어긋나면 채점기가 조용히 깨지므로 drift 테스트가 배타성·실존성을 고정한다.
//
// 마커 정책: **1차는 고유명사**(가상 개체라 corpus 밖 등장 확률≈0 → 교차오염 판정이 깨끗),
// 숫자는 보조. 연도·비트수 단독 판정은 우연 출현 오탐이 있어 쓰지 않는다.

/** `agent_loop_docs_v1` — 문서별 배타 마커. primary 가 판정, numeric 은 보강. */
export const AGENT_DOCS_GROUND_TRUTH = {
  doc_kestrel: { primary: ["halcyon"], numeric: ["192"] },
  doc_marlin: { primary: ["vela"], numeric: ["384"] },
  doc_quartz: { primary: ["shortest-vector", "duval"], numeric: ["2011"] },
} as const;
export type AgentDocsGroundTruthId = keyof typeof AGENT_DOCS_GROUND_TRUTH;

/** `agent_loop_grounding_v1` — 레코드 id → 본문 고유 마커(읽지 않으면 알 수 없는 토큰). */
export const AGENT_GROUNDING_GROUND_TRUTH = {
  "rec_9f3a1c77-4b2e": { primary: ["halcyon", "aster"] },
  "rec_0d84e2ab-77f1": { primary: ["vela", "marlin"] },
} as const;
export type AgentGroundingRecordId = keyof typeof AGENT_GROUNDING_GROUND_TRUTH;

/** `agent_loop_mock_v1`/`budget_v1`/`error_v1` — AES canon 유지 시나리오의 마커. */
export const AGENT_AES_GROUND_TRUTH = {
  /** 요약이 실제 문서를 반영하는지(≥2 히트면 충실). */
  markers: ["rijndael", "fips-197", "128"] as const,
  /** `wiki_read` **성공 본문에만** 등장 — read_document 본문엔 없다. 위키 도달/재시도 성공의 증거. */
  wikiOnlyMarker: "supersedes des",
  /** `sources[]` 가 참조해야 하는 문서 식별자. */
  sourceToken: "aes",
  /** 에러 페이로드를 본문으로 오인 요약했는지. */
  errorLeakMarker: "page_load_failed",
} as const;
