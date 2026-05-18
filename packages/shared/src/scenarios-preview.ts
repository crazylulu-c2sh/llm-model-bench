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
];

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
        "Output ONLY a single fenced code block ```js ... ``` with no prose.",
      ].join(" ");
    case "code_sort_py":
      return [
        "Write Python def sort_nums(arr) that returns a new list of numbers sorted in ascending order using quicksort that you implement yourself.",
        "Do not use sorted(), list.sort(), or any other built-in sort.",
        "Output ONLY a single fenced code block ```python ... ``` with no prose.",
      ].join(" ");
    case "chat_time_calendar": {
      const iso = opts?.referenceIso ?? new Date().toISOString();
      const tz = opts?.calendarTimeZone ?? "Asia/Seoul";
      return [
        `Reference instant (ISO 8601): ${iso}`,
        `Interpret calendar dates in time zone: ${tz}.`,
        "Reply briefly in Korean. Your reply must include exactly three Gregorian dates as YYYY-MM-DD substrings: yesterday, today, and tomorrow relative to that reference instant (in that time zone). Short Korean prose is allowed, but all three dates must appear.",
      ].join("\n");
    }
    case "tool_weather":
      return "What is the weather in Seattle? Use the provided tool.";
    case "structured_action":
      return 'Reply with ONLY valid JSON (no markdown) matching: {"action":"string","confidence":number} where confidence is 0-1.';
    case "translate_nist_fips197_pdf_tools": {
      const base = opts?.publicAssetBaseUrl?.replace(/\/+$/, "") ?? "<PUBLIC_ASSET_BASE>";
      const pdfUrl = `${base}/nist.fips.197.pdf`;
      return [
        "You have tools fetch_url and fetch_pdf_text (bench server executes them).",
        `1) Call fetch_pdf_text with url exactly: ${pdfUrl}`,
        "2) From the returned English text, write a concise Korean summary within 1000 characters. Korean only. No quotes, no English, do not paste the full PDF.",
      ].join("\n");
    }
    default:
      return `Unknown scenario: ${id}`;
  }
}

/** 벤치 시나리오의 시스템 프롬프트 미리보기(저장·UI 표시용). */
export function getScenarioSystemPromptPreview(id: string): string {
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
        "You are a strict date-format assistant.",
        "Follow the user-provided reference instant and time zone exactly.",
        "Return Korean text and ensure required YYYY-MM-DD substrings are present exactly as requested.",
      ].join(" ");
    case "tool_weather":
      return [
        "You are a tool-using assistant.",
        "When the user asks for weather, call the available weather tool before giving the final answer.",
      ].join(" ");
    case "structured_action":
      return [
        "You are a strict JSON assistant.",
        "Output must be valid JSON only, with no markdown fences, no prose, and no extra keys unless requested.",
      ].join(" ");
    case "code_sort_js":
      return [
        "You are a code-generation assistant.",
        "Return only one fenced ```js``` block with no prose.",
        "Do not use built-in sort helpers.",
      ].join(" ");
    case "code_sort_py":
      return [
        "You are a code-generation assistant.",
        "Return only one fenced ```python``` block with no prose.",
        "Do not use built-in sort helpers.",
      ].join(" ");
    case "translate_nist_fips197_pdf_tools":
      return [
        "You are a tool-using translation assistant.",
        "Use the provided fetch tools to read source text first, then produce a concise Korean-only summary.",
      ].join(" ");
    default:
      return "You are a helpful assistant. Follow the user instruction exactly.";
  }
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
