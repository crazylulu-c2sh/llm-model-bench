/** `getScenarioUserPromptPreview` 옵션 — 서버 `scenarioUserMessageContent`와 동기화 */
export type ScenarioPromptPreviewOpts = {
  publicAssetBaseUrl?: string;
  /** ISO 8601 — `chat_time_calendar` 프롬프트·채점 기준 시각 */
  referenceIso?: string;
  /** IANA — 기본 Asia/Seoul */
  calendarTimeZone?: string;
  /** stress 워크로드 워커별 user 변형(`(client {k})`). 0이면 기본 prompt. */
  stressWorkerIndex?: number;
};

/** 시나리오 ID — 서버 `scenarios.ts`와 동기화 */
export type ScenarioId =
  | "chat_hello"
  | "chat_ping"
  | "chat_time_calendar"
  | "tool_weather"
  | "structured_action"
  | "code_sort_js"
  | "code_sort_py"
  | "translate_nist_fips197_pdf_tools"
  | "vision_table_ocr_a"
  | "vision_table_ocr_b"
  | "vision_count_red_cars_a"
  | "vision_count_red_cars_b"
  | "vision_chart_peak_a"
  | "vision_chart_peak_b"
  | "vision_meme_explain_a"
  | "vision_meme_explain_b"
  | "vision_wireframe_html_a"
  | "vision_wireframe_html_b"
  | "stress_ping"
  | "stress_short_reply"
  | "stress_short_reply_ko"
  | "stress_short_reply_ja"
  | "stress_long_context"
  | "stress_long_context_ko"
  | "stress_long_context_ja";

/** 프로바이더 벤치 전용 워크로드 ID — 모델 벤치 시나리오 셀렉터에 자동 노출되면 안 된다. */
export type StressWorkloadId =
  | "stress_ping"
  | "stress_short_reply"
  | "stress_short_reply_ko"
  | "stress_short_reply_ja"
  | "stress_long_context"
  | "stress_long_context_ko"
  | "stress_long_context_ja";

export const STRESS_WORKLOAD_IDS: StressWorkloadId[] = [
  "stress_ping",
  "stress_short_reply",
  "stress_short_reply_ko",
  "stress_short_reply_ja",
  "stress_long_context",
  "stress_long_context_ko",
  "stress_long_context_ja",
];

/** 모델 벤치 탭/문서 등 *공개* 시나리오 — `stress_*`는 제외. */
export const PUBLIC_SCENARIO_IDS: ScenarioId[] = [
  "chat_hello",
  "chat_ping",
  "chat_time_calendar",
  "tool_weather",
  "structured_action",
  "code_sort_js",
  "code_sort_py",
  "translate_nist_fips197_pdf_tools",
  "vision_table_ocr_a",
  "vision_table_ocr_b",
  "vision_count_red_cars_a",
  "vision_count_red_cars_b",
  "vision_chart_peak_a",
  "vision_chart_peak_b",
  "vision_meme_explain_a",
  "vision_meme_explain_b",
  "vision_wireframe_html_a",
  "vision_wireframe_html_b",
];

/** PDF·툴 시나리오를 항상 마지막에 두어 나머지를 먼저 실행한다(중복 translate는 1개로). */
export function normalizeScenarioIdsForBench(ids: ScenarioId[]): ScenarioId[] {
  const translate: ScenarioId = "translate_nist_fips197_pdf_tools";
  const hasTranslate = ids.includes(translate);
  const rest = ids.filter((id) => id !== translate);
  return hasTranslate ? [...rest, translate] : rest;
}

/** 공개 시나리오의 벤치 실행 순서 — `normalizeScenarioIdsForBench` 규칙 재활용(단일 소스). */
export const BENCH_PUBLIC_EXECUTION_ORDER_IDS: ScenarioId[] =
  normalizeScenarioIdsForBench(PUBLIC_SCENARIO_IDS);

const SCENARIO_EXECUTION_ORDER_INDEX: Map<string, number> = new Map(
  BENCH_PUBLIC_EXECUTION_ORDER_IDS.map((id, i) => [id, i]),
);

/** 시나리오 ID → 벤치 실행 순서 인덱스(0-based). 미등록 ID(stress 등)는 목록 끝 뒤로. */
export function scenarioExecutionOrderIndex(id: string): number {
  const i = SCENARIO_EXECUTION_ORDER_INDEX.get(id);
  return i === undefined ? BENCH_PUBLIC_EXECUTION_ORDER_IDS.length : i;
}

/** 비전 시나리오 ID — 카테고리 라벨링·필터링용 */
export const VISION_SCENARIO_IDS: ScenarioId[] = [
  "vision_table_ocr_a",
  "vision_table_ocr_b",
  "vision_count_red_cars_a",
  "vision_count_red_cars_b",
  "vision_chart_peak_a",
  "vision_chart_peak_b",
  "vision_meme_explain_a",
  "vision_meme_explain_b",
  "vision_wireframe_html_a",
  "vision_wireframe_html_b",
];

/** 모델 벤치 UI 체크박스 초기 선택값 + 서버 폴백 — 비전은 opt-in이므로 텍스트 8개만. */
export const DEFAULT_SCENARIO_IDS: ScenarioId[] = [
  "chat_hello",
  "chat_ping",
  "chat_time_calendar",
  "tool_weather",
  "structured_action",
  "code_sort_js",
  "code_sort_py",
  "translate_nist_fips197_pdf_tools",
];

/** 시나리오 카테고리 — UI 그룹 헤더용 */
export type ScenarioCategory = "text" | "vision" | "agent";
export function scenarioCategory(id: string): ScenarioCategory {
  if (id.startsWith("vision_")) return "vision";
  if (id.startsWith("agent_")) return "agent";
  return "text";
}

export function isVisionScenario(id: string): boolean {
  return (VISION_SCENARIO_IDS as readonly string[]).includes(id);
}

/** 멀티턴 에이전트 시나리오(빌트인 `agent_*`). 카테고리는 id 접두에서 파생. */
export function isAgentScenario(id: string): boolean {
  return id.startsWith("agent_");
}

/** 전체 시나리오 (공개 + 스트레스). 시나리오 ID 유효성 검사·테스트 fixture용. */
export const ALL_SCENARIO_IDS: ScenarioId[] = [
  ...PUBLIC_SCENARIO_IDS,
  ...STRESS_WORKLOAD_IDS,
];

import {
  LONG_CONTEXT_SYSTEM_EN,
  LONG_CONTEXT_SYSTEM_JA,
  LONG_CONTEXT_SYSTEM_KO,
  LONG_CONTEXT_USER_EN,
  LONG_CONTEXT_USER_JA,
  LONG_CONTEXT_USER_KO,
} from "./stress-long-context-corpus";
import { DEFAULT_CALENDAR_TIMEZONE } from "./scenario-scoring-constants";
import { getScenarioDef } from "./scenario-registry";
import { visionSubcategoryLabel } from "./vision-category";

const STRESS_PING_USER_BASE = "ping";
const STRESS_SHORT_REPLY_EN_USER = "In one short sentence, explain what a load test measures.";
const STRESS_SHORT_REPLY_KO_USER = "한 문장으로, 부하 테스트가 무엇을 측정하는지 설명하세요.";
const STRESS_SHORT_REPLY_JA_USER = "一文で、負荷テストが何を測定するか説明してください。";

function appendStressClientSuffix(base: string, idx: number | undefined, lang: "en" | "ko" | "ja"): string {
  if (idx == null || idx <= 0) return base;
  if (lang === "ko") return `${base} (클라이언트 ${idx})`;
  if (lang === "ja") return `${base} (クライアント ${idx})`;
  return `${base} (client ${idx})`;
}

/**
 * 벤치 시나리오의 사용자 프롬프트 미리보기(저장·UI 표시용).
 * `translate_nist_fips197_pdf_tools`는 `publicAssetBaseUrl`(예: Vite origin)이 포함된다.
 * `chat_time_calendar`는 `referenceIso`·`calendarTimeZone`이 포함된다.
 */
export function getScenarioUserPromptPreview(id: string, opts?: ScenarioPromptPreviewOpts): string {
  const def = getScenarioDef(id); // #79/#83: 레지스트리 시나리오 fallback(built-in 분기 전).
  if (def) return def.user;
  switch (id as ScenarioId) {
    case "chat_hello":
      return "hello";
    case "chat_ping":
      return "ping";
    case "stress_ping":
      return appendStressClientSuffix(STRESS_PING_USER_BASE, opts?.stressWorkerIndex, "en");
    case "stress_short_reply":
      return appendStressClientSuffix(STRESS_SHORT_REPLY_EN_USER, opts?.stressWorkerIndex, "en");
    case "stress_short_reply_ko":
      return appendStressClientSuffix(STRESS_SHORT_REPLY_KO_USER, opts?.stressWorkerIndex, "ko");
    case "stress_short_reply_ja":
      return appendStressClientSuffix(STRESS_SHORT_REPLY_JA_USER, opts?.stressWorkerIndex, "ja");
    case "stress_long_context":
      return appendStressClientSuffix(LONG_CONTEXT_USER_EN, opts?.stressWorkerIndex, "en");
    case "stress_long_context_ko":
      return appendStressClientSuffix(LONG_CONTEXT_USER_KO, opts?.stressWorkerIndex, "ko");
    case "stress_long_context_ja":
      return appendStressClientSuffix(LONG_CONTEXT_USER_JA, opts?.stressWorkerIndex, "ja");
    case "code_sort_js":
      return [
        "Write a JavaScript function sortNums(arr) that returns a new array of numbers sorted in ascending order using quicksort that you implement yourself.",
        "Do not use Array.prototype.sort, .sort(, or any other built-in sort.",
      ].join(" ");
    case "code_sort_py":
      return [
        "Write Python def sort_nums(arr) that returns a new list of numbers sorted in ascending order using quicksort that you implement yourself.",
        "Do not use sorted(), list.sort(), or any other built-in sort.",
      ].join(" ");
    case "chat_time_calendar": {
      const iso = opts?.referenceIso ?? new Date().toISOString();
      const tz = opts?.calendarTimeZone ?? DEFAULT_CALENDAR_TIMEZONE;
      const todayStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(iso));
      return [
        `오늘 날짜 (${tz}): ${todayStr}`,
        "Reply briefly in Korean. Using the date on the first line as today, include exactly three Gregorian dates as YYYY-MM-DD substrings — yesterday (that date minus one day), today (that exact date), and tomorrow (that date plus one day). Short Korean prose is allowed, but all three YYYY-MM-DD dates must appear in this final reply, not only in your reasoning.",
      ].join("\n");
    }
    case "tool_weather":
      return "What is the weather in Seattle? Use the provided tool.";
    case "structured_action":
      return [
        "You are reviewing a draft quarterly report. Choose an action (submit, revise, or hold)",
        "and your confidence in that decision. Reply with JSON only.",
      ].join(" ");
    case "translate_nist_fips197_pdf_tools": {
      const base = opts?.publicAssetBaseUrl?.replace(/\/+$/, "") ?? "<PUBLIC_ASSET_BASE>";
      const pdfUrl = `${base}/nist.fips.197.pdf`;
      return `Summarize the NIST FIPS 197 (AES) standard from this PDF in Korean:\n${pdfUrl}`;
    }
    case "vision_table_ocr_a":
    case "vision_table_ocr_b":
      return [
        "Locate the row labeled \"Net Income\" (case-insensitive — `NET INCOME` / `Net Income` 모두 동일하게 취급).",
        "*Not* \"Net Income Attributable to …\" nor any other sub-row.",
        "Report its **2024 Actual** value and **YoY Change** percent.",
        "Respond with JSON only: {\"net_income_2024\": <number>, \"net_income_yoy_percent\": <number>}.",
        "Use plain numbers — no currency symbols, no `%` sign, no commas.",
      ].join(" ");
    case "vision_count_red_cars_a":
    case "vision_count_red_cars_b":
      return [
        "Count the number of distinctly red cars in this aerial parking lot photo.",
        "Only count cars whose body color is unambiguously red (not orange, maroon, or dark red shadows).",
        "Respond with JSON only: {\"red_cars\": <integer>}.",
      ].join(" ");
    case "vision_chart_peak_a":
    case "vision_chart_peak_b":
      return [
        "Look at this multi-line chart of product market share.",
        "Identify the highest peak in the entire chart: which product, at which quarter, and what value (in percent).",
        "Respond with JSON only: {\"product\":\"A\"|\"B\"|\"C\"|\"D\"|\"E\",\"quarter\":\"Q1 2023\"|\"Q2 2023\"|\"Q3 2023\"|\"Q4 2023\"|\"Q1 2024\"|\"Q2 2024\"|\"Q3 2024\"|\"Q4 2024\",\"value_percent\": <number>}.",
      ].join(" ");
    case "vision_meme_explain_a":
    case "vision_meme_explain_b":
      return "이 밈이 풍자하는 바와 두 패널의 대비를 설명하세요.";
    case "vision_wireframe_html_a":
    case "vision_wireframe_html_b":
      return [
        "Recreate this hand-drawn website wireframe.",
        "Include every labeled section with the same text labels.",
      ].join(" ");
    default:
      return `Unknown scenario: ${id}`;
  }
}

/** 벤치 시나리오의 시스템 프롬프트 미리보기(저장·UI 표시용). */
export function getScenarioSystemPromptPreview(id: string): string {
  const def = getScenarioDef(id); // #79/#83: 레지스트리 시나리오 fallback(built-in 분기 전).
  if (def) return def.system;
  switch (id as ScenarioId) {
    case "chat_hello":
    case "chat_ping":
    case "stress_ping":
      return "You are a concise assistant. Follow the user instruction exactly and do not add extra explanation.";
    case "stress_short_reply":
      return "You are a concise assistant. Reply in one short sentence only. No lists, no markdown, no preamble.";
    case "stress_short_reply_ko":
      return "당신은 간결한 한국어 보조자입니다. 한국어로 한 문장만 답하세요. 목록·마크다운·서두 없이.";
    case "stress_short_reply_ja":
      return "あなたは簡潔な日本語アシスタントです。日本語で一文だけ答えてください。箇条書き・マークダウン・前置きは禁止。";
    case "stress_long_context":
      return LONG_CONTEXT_SYSTEM_EN;
    case "stress_long_context_ko":
      return LONG_CONTEXT_SYSTEM_KO;
    case "stress_long_context_ja":
      return LONG_CONTEXT_SYSTEM_JA;
    case "chat_time_calendar":
      return [
        "You are a date-format assistant.",
        "Treat the date on the first user line as the authoritative today — compute yesterday and tomorrow strictly by ±1 calendar day from that exact date, and do not substitute today's real-world date or any year from your training data.",
        "Return Korean text and ensure the required YYYY-MM-DD substrings are present exactly as requested.",
      ].join(" ");
    case "tool_weather":
      return [
        "You are a tool-using assistant.",
        "You MUST call the available weather tool whenever the user asks about current or forecast conditions — do not answer weather from memory or prior knowledge.",
        "The weather tool is read-only and ready to use: call it immediately in this turn without asking for permission, then give the final answer based on its result.",
      ].join(" ");
    case "structured_action":
      return [
        "You are a strict JSON assistant.",
        "Return only JSON and nothing else — no preamble, no Markdown backticks, no prose, no extra keys, and no text before or after.",
        "Emit exactly one object and stop; do not append a second object, a trailing note, or a follow-up question.",
        'Respond with a single object: {"action":"<string>","confidence":<number>} where action is one of submit/revise/hold and confidence is a number between 0 and 1 inclusive.',
      ].join(" ");
    case "code_sort_js":
      return [
        "You are a code-generation assistant.",
        "Return only one fenced ```js``` block with no prose.",
        "Do not add comments or docstrings inside the code — return only the code itself.",
        "Do not use built-in sort helpers.",
      ].join(" ");
    case "code_sort_py":
      return [
        "You are a code-generation assistant.",
        "Return only one fenced ```python``` block with no prose.",
        "Do not add comments or docstrings inside the code — return only the code the task requires.",
        "Do not use built-in sort helpers.",
      ].join(" ");
    case "translate_nist_fips197_pdf_tools":
      return [
        "You are a tool-using translation assistant.",
        "For PDF sources you MUST call fetch_pdf_text (not fetch_url) to actually read the document — do not summarize from memory or prior knowledge of the standard. If fetch_url returns a binary/PDF error, retry the same URL with fetch_pdf_text.",
        "Read the full source first, then write a concise Korean-only summary. Aim for roughly 500–800 characters and never reach 1000 characters (the summary is rejected at 1000 or more).",
        "No quotes, no English, do not paste the full document.",
      ].join(" ");
    case "vision_table_ocr_a":
    case "vision_table_ocr_b":
      return "You are a strict JSON OCR assistant. Read the requested value directly from the attached table image and transcribe it — do not defer to a tool or refuse. Output a single JSON object only — no markdown, no prose.";
    case "vision_count_red_cars_a":
    case "vision_count_red_cars_b":
      return "You are a strict counting assistant. Count carefully from the image itself, then commit to your single best-estimate integer count — do not refuse, hedge, or abstain because the image is dense or ambiguous. Reply with exactly one minimal JSON object and nothing else — no prose, no second JSON object, and no additional count value anywhere.";
    case "vision_chart_peak_a":
    case "vision_chart_peak_b":
      return "You are a strict chart-reading assistant. Reply with the single requested JSON object only — no markdown, no preamble, no explanation, no uncertainty hedging.";
    case "vision_meme_explain_a":
    case "vision_meme_explain_b":
      return [
        "You are an image-reading assistant.",
        "Reply in Korean only, in 3–5 concrete sentences.",
        "Be specific about both panels.",
      ].join(" ");
    case "vision_wireframe_html_a":
    case "vision_wireframe_html_b":
      return [
        "You are a frontend assistant.",
        "Recreate wireframes as semantic HTML5 using Tailwind CSS utility classes.",
        "Reply with a single fenced ```html``` block only — no prose or commentary.",
      ].join(" ");
    default:
      return "You are a helpful assistant. Follow the user instruction exactly.";
  }
}

/** 비전 시나리오 이미지 자산 매핑 — 서버·UI 공통. v1.2부터 JPEG (LM Studio WebP MIME 거부 우회). */
export type ScenarioImageAsset = { url: string; alt: string; mime: "image/jpeg" };

const VISION_IMAGE_FILES: Record<string, string> = {
  vision_table_ocr_a: "table_ocr_a.jpg",
  vision_table_ocr_b: "table_ocr_b.jpg",
  vision_count_red_cars_a: "count_red_cars_a.jpg",
  vision_count_red_cars_b: "count_red_cars_b.jpg",
  vision_chart_peak_a: "chart_peak_a.jpg",
  vision_chart_peak_b: "chart_peak_b.jpg",
  vision_meme_explain_a: "meme_explain_a.jpg",
  vision_meme_explain_b: "meme_explain_b.jpg",
  vision_wireframe_html_a: "wireframe_html_a.jpg",
  vision_wireframe_html_b: "wireframe_html_b.jpg",
};

/** 비전 시나리오의 이미지 자산 경로 반환. 텍스트 시나리오는 빈 배열. */
export function getScenarioImageAssets(
  id: string,
  baseUrl?: string,
): ScenarioImageAsset[] {
  const filename = VISION_IMAGE_FILES[id];
  if (!filename) return [];
  const base = baseUrl?.replace(/\/+$/, "") ?? "";
  const category = visionSubcategoryLabel(id);
  return [
    {
      url: `${base}/vision/${filename}`,
      alt: category ? `${category} 시나리오 예시 이미지 (${id})` : id,
      mime: "image/jpeg",
    },
  ];
}

/** 비전 시나리오 이미지 파일명 — 서버 vision-assets 모듈이 읽는 경로 기반 */
export function visionImageFilename(id: string): string | null {
  return VISION_IMAGE_FILES[id] ?? null;
}

/** 채점 루브릭 0~3 → score(0~1)·pass(>=0.67) 매핑. 단일 위치 — 서버·judge·UI 공통 호출. */
export function rubricToScore(n: 0 | 1 | 2 | 3): { score: number; pass: boolean } {
  if (n === 3) return { score: 1, pass: true };
  if (n === 2) return { score: 0.67, pass: true };
  if (n === 1) return { score: 0.33, pass: false };
  return { score: 0, pass: false };
}

/**
 * `rubricToScore`의 역함수 — 비전 시나리오의 score(0/0.33/0.67/1)로부터 루브릭 0~3 복원.
 * 부동소수점 오차 허용을 위해 ±0.05 tolerance로 가장 가까운 단계를 선택.
 * 입력 범위 밖이거나 NaN이면 null. UI 표시(`ResultsTable`, `ScenarioDetailDrawer`)에서 사용.
 */
export function scoreToRubric(score: number | null | undefined): 0 | 1 | 2 | 3 | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score < 0 || score > 1) return null;
  const targets: Array<{ rubric: 0 | 1 | 2 | 3; value: number }> = [
    { rubric: 0, value: 0 },
    { rubric: 1, value: 0.33 },
    { rubric: 2, value: 0.67 },
    { rubric: 3, value: 1 },
  ];
  let best: { rubric: 0 | 1 | 2 | 3; diff: number } | null = null;
  for (const t of targets) {
    const diff = Math.abs(score - t.value);
    if (best == null || diff < best.diff) best = { rubric: t.rubric, diff };
  }
  // ±0.05 안에 들지 않으면 보수적으로 null 반환 — 모르는 스케일은 표시 안 함.
  if (!best || best.diff > 0.05) return null;
  return best.rubric;
}

/**
 * 비전 시나리오별 기본 max_tokens (bench-runner는 `Math.max`로 floor 역할).
 *
 * - wireframe: 4096 — 긴 HTML 출력
 * - meme: 1024 — 한국어 3~5문장 (reasoning 모델은 사용자 UI에서 더 큰 값 권장)
 * - chart / OCR / counting: 2048 — JSON 자체는 짧지만(10~50 토큰) reasoning 모델이
 *   평문 trace를 길게 쏟는 경우 v1.2까지 512로는 JSON 도달 전에 잘렸음. v1.3에서 2048로 상향.
 */
export function defaultMaxTokensForVisionScenario(id: string): number | null {
  if (id === "vision_wireframe_html_a" || id === "vision_wireframe_html_b") return 4096;
  if (id === "vision_meme_explain_a" || id === "vision_meme_explain_b") return 1024;
  if ((VISION_SCENARIO_IDS as readonly string[]).includes(id)) return 2048;
  return null;
}

export function isScenarioId(id: string): id is ScenarioId {
  return (ALL_SCENARIO_IDS as string[]).includes(id);
}

export function isStressWorkloadId(id: string): id is StressWorkloadId {
  return (STRESS_WORKLOAD_IDS as string[]).includes(id);
}

/** 워크로드의 *예상* 응답 스크립트 — `script_match`와 결과 라벨용. */
export function expectedScriptForWorkload(id: StressWorkloadId): "latin" | "ko" | "ja" {
  switch (id) {
    case "stress_short_reply_ko":
    case "stress_long_context_ko":
      return "ko";
    case "stress_short_reply_ja":
    case "stress_long_context_ja":
      return "ja";
    default:
      return "latin";
  }
}

/** 워크로드의 *기본* max_tokens — 서버·UI 동일 값. */
export function defaultMaxTokensForWorkload(id: StressWorkloadId): number {
  switch (id) {
    case "stress_ping":
    case "stress_long_context":
    case "stress_long_context_ko":
    case "stress_long_context_ja":
      return 32;
    default:
      return 128;
  }
}
