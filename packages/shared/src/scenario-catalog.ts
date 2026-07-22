import { z } from "zod";
import {
  DEFAULT_SCENARIO_IDS,
  PUBLIC_SCENARIO_IDS,
  VISION_SCENARIO_IDS,
  defaultMaxTokensForVisionScenario,
  getScenarioSystemPromptPreview,
  getScenarioUserPromptPreview,
  isVisionScenario,
  scenarioCategory,
  scenarioExecutionOrderIndex,
  type ScenarioId,
  type ScenarioPromptPreviewOpts,
} from "./scenarios-preview";
import { getScenarioBenchMetaKoWire } from "./scenario-meta";
import { openAiToolsForScenario } from "./scenario-tools";
import { getScenarioDef } from "./scenario-registry";
import { BUILTIN_AGENT_LOOP_IDS } from "./agent-loop-builtin";

/**
 * 에이전트 대상 시나리오 카탈로그 — `GET /api/scenarios`(및 MCP `list_scenarios`)가 반환.
 * 모든 필드는 기존 `@llm-bench/shared` getter 조합이라 별도 데이터 소스가 없다.
 */
export const ScenarioMetaSchema = z.object({
  purposeKo: z.string(),
  criteriaKo: z.string(),
  promptNotesKo: z.string().optional(),
  toolsSummaryKo: z.string().optional(),
  routesKo: z.string().optional(),
  implementationKo: z.string().optional(),
});

export const ScenarioDescriptorSchema = z.object({
  id: z.string(),
  category: z.enum(["text", "vision", "agent"]),
  isVision: z.boolean(),
  inDefaultSet: z.boolean(),
  inVisionSet: z.boolean(),
  executionOrder: z.number().int(),
  attachesTools: z.boolean(),
  toolNames: z.array(z.string()),
  defaultMaxTokensFloor: z.number().int().nullable(),
  prompt: z.object({
    system: z.string(),
    user: z.string(),
  }),
  meta: ScenarioMetaSchema.nullable(),
  /** #79/#83: built-in 카탈로그 vs 사용자 커스텀. */
  source: z.enum(["builtin", "custom"]).default("builtin"),
  /** #79: 멀티턴 agent_loop 여부. */
  isAgentLoop: z.boolean().default(false),
  /** #79: agent_loop 최대 턴 예산(아니면 null). */
  maxTurns: z.number().int().nullable().default(null),
});
export type ScenarioDescriptor = z.infer<typeof ScenarioDescriptorSchema>;

export const ScenarioCatalogResponseSchema = z.object({
  scenarios: z.array(ScenarioDescriptorSchema),
});
export type ScenarioCatalogResponse = z.infer<typeof ScenarioCatalogResponseSchema>;

/** OpenAI 도구 배열에서 함수명만 뽑는다(카탈로그·문서 표기용). */
function toolNamesFor(id: string): string[] {
  const tools = openAiToolsForScenario(id);
  if (!Array.isArray(tools)) return [];
  const names: string[] = [];
  for (const t of tools) {
    const fn = (t as { function?: { name?: unknown } })?.function;
    if (fn && typeof fn.name === "string") names.push(fn.name);
  }
  return names;
}

/**
 * 시나리오 ID 목록을 서술형 descriptor로 조립한다(기본: PUBLIC 세트).
 * `translate_*`/`chat_time_calendar` 등 옵션 의존 프롬프트는 `opts`로 결정론화한다(문서 페이지와 동일).
 */
export function buildScenarioCatalog(
  ids: readonly string[] = PUBLIC_SCENARIO_IDS,
  opts?: ScenarioPromptPreviewOpts,
): ScenarioDescriptor[] {
  const defaultSet = new Set<string>(DEFAULT_SCENARIO_IDS);
  const visionSet = new Set<string>(VISION_SCENARIO_IDS);
  return ids.map((id) => {
    const def = getScenarioDef(id); // #79/#83: 레지스트리 시나리오면 descriptor를 def에서 합성.
    const toolNames = toolNamesFor(id);
    let meta: ScenarioDescriptor["meta"] = null;
    try {
      meta = getScenarioBenchMetaKoWire(id) ?? null;
    } catch {
      meta = null;
    }
    return {
      id,
      category: scenarioCategory(id),
      isVision: isVisionScenario(id),
      inDefaultSet: defaultSet.has(id),
      inVisionSet: visionSet.has(id),
      executionOrder: scenarioExecutionOrderIndex(id),
      attachesTools: toolNames.length > 0,
      toolNames,
      defaultMaxTokensFloor: defaultMaxTokensForVisionScenario(id as ScenarioId) ?? null,
      prompt: {
        system: getScenarioSystemPromptPreview(id),
        user: getScenarioUserPromptPreview(id, opts),
      },
      meta,
      source: def?.source ?? "builtin",
      isAgentLoop: !!def?.agentLoop,
      maxTurns: def?.agentLoop?.maxTurns ?? null,
    };
  });
}

// ─── task 필터 → 시나리오 ID 매핑(web·server·mcp 공유) ─────────────────────────
// `GET /api/scoreboard?task=…`와 web Scoreboard 카테고리 필터가 동일 집합을 쓰도록 단일 소스.
export const SCOREBOARD_TASKS = ["coding", "vision", "tools", "structured", "chat", "agent"] as const;
export type ScoreboardTask = (typeof SCOREBOARD_TASKS)[number];

const TASK_SCENARIO_IDS: Record<ScoreboardTask, readonly string[]> = {
  coding: ["code_sort_js", "code_sort_py"],
  vision: VISION_SCENARIO_IDS,
  tools: ["tool_weather", "translate_nist_fips197_pdf_tools"],
  structured: ["structured_action"],
  chat: ["chat_hello", "chat_ping", "chat_time_calendar"],
  agent: BUILTIN_AGENT_LOOP_IDS,
};

export function isScoreboardTask(x: string): x is ScoreboardTask {
  return (SCOREBOARD_TASKS as readonly string[]).includes(x);
}

/** task 이름 → 해당 시나리오 ID 집합. 미지정/미지원이면 undefined(= 전체 사용). */
export function scenarioIdsForTask(task: string | null | undefined): Set<string> | undefined {
  if (!task || !isScoreboardTask(task)) return undefined;
  return new Set(TASK_SCENARIO_IDS[task]);
}

// ─── 서버 스코어보드 응답 스키마(`GET /api/scoreboard`) — 엔드포인트·OpenAPI·MCP 공용 ──
// computeScoreboard 결과(ModelQualityScore/ModelSpeedScore)를 rank와 함께 반환하는 형태.
const QualityGroupScoreSchema = z.object({
  value: z.number().nullable(),
  covered: z.number().int(),
  expected: z.number().int(),
});
const ModelQualityScoreSchema = z.object({
  model_id: z.string(),
  text: QualityGroupScoreSchema,
  vision: QualityGroupScoreSchema,
  agent: QualityGroupScoreSchema,
  total: QualityGroupScoreSchema,
  textOnly: z.boolean(),
  caveats: z.array(z.enum(["judge_capped", "vision_partial", "no_quality_data"])),
  judgeCappedScenarios: z.number().int(),
});
const SpeedGroupSchema = z.object({
  score: z.number().nullable(),
  ttftMs: z.number().nullable(),
  scoredRows: z.number().int(),
  approxRows: z.number().int(),
  tpsMedian: z.number().nullable(),
  tpsMin: z.number().nullable(),
  tpsMax: z.number().nullable(),
});
const ModelSpeedScoreSchema = z.object({
  model_id: z.string(),
  text: SpeedGroupSchema,
  vision: SpeedGroupSchema,
  agent: SpeedGroupSchema,
  total: SpeedGroupSchema,
  textOnly: z.boolean(),
  approxCaveat: z.boolean(),
});
export const ScoreboardRowResponseSchema = z.object({
  rank: z.number().int(),
  model_id: z.string(),
  quality: ModelQualityScoreSchema,
  speed: ModelSpeedScoreSchema,
  textOnly: z.boolean(),
});
// #80: 모델 × api_route 누수/정체 지표. rows(랭킹)와 분리 — 라우트별로 다르게 나타나므로 풀링하지 않는다.
export const LeakMetricsRowSchema = z.object({
  model_id: z.string(),
  api_route: z.enum(["chat_completions", "messages"]),
  /** reasoning_tokens / total_output_tokens (0~1). 측정 가능한 출력 없으면 null. */
  thinking_leak_ratio: z.number().nullable(),
  /** 가시 content 비었고 tool_call 없는 런 비율(0~1). */
  empty_turn_rate: z.number(),
  /** 가시 content에 채널/thinking 태그 남은 런 비율(0~1). */
  channel_tag_leak: z.number(),
  /** 이 슬라이스 런 수. */
  n: z.number().int(),
});
export type LeakMetricsRow = z.infer<typeof LeakMetricsRowSchema>;
// #105: 모델 × api_route 에이전트 능력 지표(agent_* 시나리오 완료 런). leaks 와 별도 — 과업
// 완료·처리량·도구 규율을 담아 raw TPS 역전을 드러낸다.
export const AgentMetricsRowSchema = z.object({
  model_id: z.string(),
  api_route: z.enum(["chat_completions", "messages"]),
  n: z.number().int(),
  task_completion_rate: z.number(),
  stall_rate: z.number(),
  budget_exhausted_rate: z.number(),
  thinking_budget_rate: z.number(),
  task_ms_median: z.number().nullable(),
  turns_median: z.number().nullable(),
  valid_tool_call_rate_mean: z.number().nullable(),
  tool_arg_fidelity: z.number().nullable(),
  arg_attempt_rate: z.number().nullable(),
  output_efficiency: z.number().nullable(),
  /** #108 후속: 결정론 rubric 평균(0~1) — 라우트별. */
  quality_mean: z.number().nullable(),
  /** #108 후속: 지시 도구 중 실제 호출 비율(점수 미반영, 진단용). */
  workflow_adherence_mean: z.number().nullable(),
  /** #109 후속: 도구 초과 호출 비율(0=낭비 없음, >0=남용). */
  tool_call_excess_mean: z.number().nullable(),
});
export type AgentMetricsRow = z.infer<typeof AgentMetricsRowSchema>;
export const ScoreboardResponseSchema = z.object({
  base_url: z.string(),
  filter: z.object({
    task: z.string().optional(),
    scenarios: z.array(z.string()).optional(),
  }),
  rows: z.array(ScoreboardRowResponseSchema),
  /** #80: 모델 × 라우트 누수/정체 지표(선택 — 구버전 응답엔 없음). */
  leaks: z.array(LeakMetricsRowSchema).optional(),
  /** #105: 모델 × 라우트 에이전트 능력 지표(선택 — agent 런 없으면 빈 배열/부재). */
  agent_metrics: z.array(AgentMetricsRowSchema).optional(),
  /** #81: 메모리-핏 프리플라이트로 skip된 모델(측정 런이 없어 rows엔 없지만 조용히 사라지지 않도록). */
  skipped: z
    .array(z.object({ model_id: z.string(), reason: z.string() }))
    .optional(),
  sqlite_available: z.boolean().optional(),
  sqlite_error: z.string().nullable().optional(),
});
export type ScoreboardResponse = z.infer<typeof ScoreboardResponseSchema>;
