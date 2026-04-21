/** `getScenarioUserPromptPreview` 옵션 — 서버 `scenarioUserMessageContent`와 동기화 */
export type ScenarioPromptPreviewOpts = {
  publicAssetBaseUrl?: string;
  /** ISO 8601 — `chat_time_calendar` 프롬프트·채점 기준 시각 */
  referenceIso?: string;
  /** IANA — 기본 Asia/Seoul */
  calendarTimeZone?: string;
};

/** 시나리오 ID — 서버 `scenarios.ts`와 동기화 */
export type ScenarioId =
  | "chat_hello"
  | "chat_ping"
  | "code_sort_js"
  | "code_sort_py"
  | "chat_time_calendar"
  | "tool_weather"
  | "structured_action"
  | "translate_nist_fips197_pdf_tools";

export const ALL_SCENARIO_IDS: ScenarioId[] = [
  "chat_hello",
  "chat_ping",
  "code_sort_js",
  "code_sort_py",
  "chat_time_calendar",
  "tool_weather",
  "structured_action",
  "translate_nist_fips197_pdf_tools",
];

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

export function isScenarioId(id: string): id is ScenarioId {
  return (ALL_SCENARIO_IDS as string[]).includes(id);
}
