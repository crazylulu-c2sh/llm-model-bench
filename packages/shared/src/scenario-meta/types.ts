export type BenchLocale = "ko" | "en" | "ja";

/** UI용 로케일 중립 시나리오 메타(목적·품질 기준 등). 서버 `scoreScenario`와 같은 맥락으로 유지. */
export type ScenarioBenchMetaText = {
  purpose: string;
  criteria: string;
  /** 문서 페이지: 사용자 메시지·주입값 설명 */
  promptNotes?: string;
  /** 문서 페이지: 노출 도구 요약(서버 `openAiToolsForScenario`와 맞출 것) */
  toolsSummary?: string;
  /** 문서 페이지: chat_completions / messages 라우팅 설명 */
  routes?: string;
  /** 문서 페이지: 채점·실행 흐름 요지 */
  implementation?: string;
};

/**
 * 와이어 계약(API `GET /api/scenarios` · MCP `list_scenarios`) — 항상 ko, 레거시 `*Ko` 필드명.
 * `ScenarioMetaSchema`와 정확히 일치해야 하므로 절대 바꾸지 말 것. 웹은 이 타입 대신 ScenarioBenchMetaText를 쓴다.
 */
export type ScenarioBenchMeta = {
  purposeKo: string;
  criteriaKo: string;
  promptNotesKo?: string;
  toolsSummaryKo?: string;
  routesKo?: string;
  implementationKo?: string;
};
