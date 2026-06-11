import {
  DEFAULT_CALENDAR_TIMEZONE,
  getScenarioBenchRequestPreview,
  getScenarioSystemPromptPreview,
  getScenarioUserPromptPreview,
  type ScenarioBenchRequestPreview,
  type ScenarioRequestPreviewOpts,
} from "@llm-bench/shared";

export type ScenarioPromptPreviewOpts = ScenarioRequestPreviewOpts;
export type { ScenarioBenchRequestPreview };

/** 벤치·통계·문서 페이지에서 동일한 사용자 프롬프트 미리보기를 쓰기 위한 헬퍼 */
export function defaultScenarioPromptPreview(
  scenarioId: string,
  opts?: ScenarioPromptPreviewOpts,
): string {
  if (scenarioId === "translate_nist_fips197_pdf_tools" && typeof window !== "undefined") {
    return getScenarioUserPromptPreview(scenarioId, { publicAssetBaseUrl: window.location.origin });
  }
  if (scenarioId === "chat_time_calendar") {
    return getScenarioUserPromptPreview(scenarioId, {
      referenceIso: opts?.referenceIso ?? new Date().toISOString(),
      calendarTimeZone: opts?.calendarTimeZone ?? DEFAULT_CALENDAR_TIMEZONE,
    });
  }
  return getScenarioUserPromptPreview(scenarioId);
}

/** 벤치·통계·문서 페이지에서 동일한 시스템 프롬프트 미리보기를 쓰기 위한 헬퍼 */
export function defaultScenarioSystemPromptPreview(scenarioId: string): string {
  return getScenarioSystemPromptPreview(scenarioId);
}

function benchRequestPreviewOpts(
  scenarioId: string,
  opts?: ScenarioPromptPreviewOpts,
): ScenarioRequestPreviewOpts {
  const base: ScenarioRequestPreviewOpts = { ...opts };
  if (typeof window !== "undefined") {
    base.publicAssetBaseUrl = window.location.origin;
  }
  if (scenarioId === "chat_time_calendar") {
    base.referenceIso = opts?.referenceIso ?? new Date().toISOString();
    base.calendarTimeZone = opts?.calendarTimeZone ?? DEFAULT_CALENDAR_TIMEZONE;
  }
  return base;
}

/** 벤치 upstream 요청 본문 미리보기 — 도구·멀티모달 파트·라우트별 페이로드 포함 */
export function defaultScenarioBenchRequestPreview(
  scenarioId: string,
  opts?: ScenarioPromptPreviewOpts,
): ScenarioBenchRequestPreview {
  return getScenarioBenchRequestPreview(scenarioId as Parameters<typeof getScenarioBenchRequestPreview>[0], benchRequestPreviewOpts(scenarioId, opts));
}
