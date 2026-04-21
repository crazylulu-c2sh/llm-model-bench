/** 시나리오 ID — 서버 `scenarios.ts`와 동기화 */
export type ScenarioId =
  | "chat_hello"
  | "chat_ping"
  | "code_sort_js"
  | "code_sort_py"
  | "translate_roundtrip_stub"
  | "tool_weather"
  | "structured_action";

export const ALL_SCENARIO_IDS: ScenarioId[] = [
  "chat_hello",
  "chat_ping",
  "code_sort_js",
  "code_sort_py",
  "translate_roundtrip_stub",
  "tool_weather",
  "structured_action",
];

/**
 * 벤치 시나리오의 사용자 프롬프트 미리보기(저장·UI 표시용).
 * `translate_roundtrip_stub`은 서버에서 발췌문을 넘기면 그대로 포함한다.
 */
export function getScenarioUserPromptPreview(
  id: string,
  opts?: { translationExcerpt?: string },
): string {
  const excerpt =
    opts?.translationExcerpt?.trim() ||
    "(영문 발췌는 서버 실행 시 fixtures에서 로드됩니다. 히스토리에는 저장 시점 문자열이 들어갑니다.)";
  switch (id as ScenarioId) {
    case "chat_hello":
      return "Reply with exactly: hello";
    case "chat_ping":
      return "Reply with exactly: pong (lowercase, one word)";
    case "code_sort_js":
      return "Write a JavaScript function sortNums(arr) that returns sorted ascending numbers. Output ONLY a single fenced code block ```js ... ``` with no prose.";
    case "code_sort_py":
      return "Write Python def sort_nums(arr): return sorted list. Output ONLY a single fenced code block ```python ... ``` with no prose.";
    case "translate_roundtrip_stub":
      return `Translate the following English excerpt to Korean in one short sentence (max 80 chars). Korean only, no quotes.\n\n${excerpt}`;
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
