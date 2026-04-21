/** 시나리오 ID — 서버 `scenarios.ts`와 동기화 */
export type ScenarioId =
  | "chat_hello"
  | "chat_ping"
  | "code_sort_js"
  | "code_sort_py"
  | "translate_bitcoin_pdf_tools"
  | "tool_weather"
  | "structured_action";

export const ALL_SCENARIO_IDS: ScenarioId[] = [
  "chat_hello",
  "chat_ping",
  "code_sort_js",
  "code_sort_py",
  "translate_bitcoin_pdf_tools",
  "tool_weather",
  "structured_action",
];

/**
 * 벤치 시나리오의 사용자 프롬프트 미리보기(저장·UI 표시용).
 * `translate_bitcoin_pdf_tools`는 `publicAssetBaseUrl`(예: Vite origin)이 포함된다.
 */
export function getScenarioUserPromptPreview(
  id: string,
  opts?: { publicAssetBaseUrl?: string },
): string {
  switch (id as ScenarioId) {
    case "chat_hello":
      return "Reply with exactly: hello";
    case "chat_ping":
      return "Reply with exactly: pong (lowercase, one word)";
    case "code_sort_js":
      return "Write a JavaScript function sortNums(arr) that returns sorted ascending numbers. Output ONLY a single fenced code block ```js ... ``` with no prose.";
    case "code_sort_py":
      return "Write Python def sort_nums(arr): return sorted list. Output ONLY a single fenced code block ```python ... ``` with no prose.";
    case "translate_bitcoin_pdf_tools": {
      const base = opts?.publicAssetBaseUrl?.replace(/\/+$/, "") ?? "<PUBLIC_ASSET_BASE>";
      const pdfUrl = `${base}/bitcoin.pdf`;
      return [
        "You have tools fetch_url and fetch_pdf_text (bench server executes them).",
        `1) Call fetch_pdf_text with url exactly: ${pdfUrl}`,
        "2) From the returned English text, write ONE short Korean sentence summarizing the opening idea (max 90 Korean characters). Korean only. No quotes, no English, do not paste the full PDF.",
      ].join("\n");
    }
    case "tool_weather":
      return "What is the weather in Seattle? Use the provided tool.";
    case "structured_action":
      return 'Reply with ONLY valid JSON (no markdown) matching: {"action":"string","confidence":number} where confidence is 0-1.';
    default:
      return `Unknown scenario: ${id}`;
  }
}

export function isScenarioId(id: string): id is ScenarioId {
  return (ALL_SCENARIO_IDS as string[]).includes(id);
}
