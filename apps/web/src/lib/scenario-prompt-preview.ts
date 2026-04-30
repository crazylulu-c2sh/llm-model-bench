import { getScenarioSystemPromptPreview, getScenarioUserPromptPreview } from "@llm-bench/shared";

/** 벤치·통계·문서 페이지에서 동일한 사용자 프롬프트 미리보기를 쓰기 위한 헬퍼 */
export function defaultScenarioPromptPreview(scenarioId: string): string {
  if (scenarioId === "translate_nist_fips197_pdf_tools" && typeof window !== "undefined") {
    return getScenarioUserPromptPreview(scenarioId, { publicAssetBaseUrl: window.location.origin });
  }
  if (scenarioId === "chat_time_calendar") {
    return getScenarioUserPromptPreview(scenarioId, {
      referenceIso: new Date().toISOString(),
      calendarTimeZone: "Asia/Seoul",
    });
  }
  return getScenarioUserPromptPreview(scenarioId);
}

/** 벤치·통계·문서 페이지에서 동일한 시스템 프롬프트 미리보기를 쓰기 위한 헬퍼 */
export function defaultScenarioSystemPromptPreview(scenarioId: string): string {
  return getScenarioSystemPromptPreview(scenarioId);
}
