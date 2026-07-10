import { z } from "zod";

/**
 * #79/#83: 런타임 시나리오 레지스트리.
 *
 * 기존 시나리오 시스템은 `ScenarioId` 유니온 + `switch(id)` getter로 닫혀 있다. 이 레지스트리는
 * 그 getter들이 리터럴 분기 *전에* 조회하는 fallback을 제공해, 유니온을 건드리지 않고 런타임
 * 시나리오(#79 built-in agent_loop, #83 사용자 커스텀)를 추가할 수 있게 한다.
 *
 * `agentLoop` 블록이 있으면 멀티턴(mock-tool 하네스), 없으면 단일 턴이다.
 */

/** provider-중립 도구 스키마(JSON-Schema params — Anthropic input_schema와 동형). */
export const RuntimeToolSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/),
  description: z.string().max(1024).default(""),
  /** JSON Schema object. */
  parameters: z.record(z.string(), z.unknown()).default({}),
});
export type RuntimeTool = z.infer<typeof RuntimeToolSchema>;

/** 저지 루브릭 — #79(최종 산출물 스키마 체크)·#83(커스텀 루브릭) 공용. */
export const JudgeRubricSchema = z.object({
  scale: z.enum(["binary", "0-3"]).default("0-3"),
  criterion: z.string().min(1).max(4000),
});
export type JudgeRubric = z.infer<typeof JudgeRubricSchema>;

/** 하네스가 요청 바디로 전달하는 샘플링 파라미터. */
export const ScenarioSamplingSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().max(32768).optional(),
  top_p: z.number().min(0).max(1).optional(),
});
export type ScenarioSampling = z.infer<typeof ScenarioSamplingSchema>;

/** #79: 캔드(canned) 도구 결과 큐 — 매칭되는 도구 호출마다 순서대로 소비. */
export const MockToolSchema = z.object({
  tool: z.string().min(1),
  responses: z.array(z.string().max(200_000)).min(1),
  /** 큐 소진 시 마지막 응답을 반복할지(false면 소진 후 에러 결과). */
  repeatLast: z.boolean().default(true),
});
export type MockTool = z.infer<typeof MockToolSchema>;

/** #79: 하네스가 루프 완료 상태에 도달했는지 판정하는 방법. */
export const CompletionPredicateSchema = z
  .object({
    type: z.enum(["no_tool_calls", "contains", "regex", "json_valid"]),
    pattern: z.string().max(2000).optional(),
  })
  .refine((p) => (p.type === "contains" || p.type === "regex" ? !!p.pattern : true), {
    message: "pattern required for contains/regex",
    path: ["pattern"],
  });
export type CompletionPredicate = z.infer<typeof CompletionPredicateSchema>;

/** #79: 멀티턴 mock-tool 블록. 존재하면 시나리오가 멀티턴이다. */
export const AgentLoopSchema = z.object({
  maxTurns: z.number().int().min(1).max(16),
  mockTools: z.array(MockToolSchema).min(1),
  completion: CompletionPredicateSchema,
});
export type AgentLoop = z.infer<typeof AgentLoopSchema>;

/**
 * 선언형 시나리오 정의. #79가 이 스키마 전체를 도입한다(agentLoop 블록 = 선언형 agent_loop def).
 * #83의 커스텀-시나리오 입력은 이 스키마를 그대로 재사용/정제한다 — 단일 턴 커스텀은 agentLoop 생략,
 * 멀티턴 커스텀은 agentLoop 포함. (그 superset 관계는 #83의 CustomScenarioInputSchema에서 명시.)
 */
export const ScenarioDefSchema = z.object({
  id: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/),
  source: z.enum(["builtin", "custom"]).default("builtin"),
  system: z.string().max(20_000),
  /** 초기 user 메시지. */
  user: z.string().max(20_000),
  tools: z.array(RuntimeToolSchema).max(16).default([]),
  sampling: ScenarioSamplingSchema.optional(),
  /** undefined면 감지된 라우트 모두에서 실행. */
  apiRoute: z.enum(["chat_completions", "messages"]).optional(),
  judge: JudgeRubricSchema.optional(),
  agentLoop: AgentLoopSchema.optional(),
});
export type ScenarioDef = z.infer<typeof ScenarioDefSchema>;

// ─── 도구 스키마 변환(레지스트리 → provider 형태) ──────────────────────────────
export function runtimeToolsToOpenAi(
  tools: readonly RuntimeTool[],
): Array<{ type: "function"; function: { name: string; description: string; parameters: unknown } }> {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function runtimeToolsToAnthropic(
  tools: readonly RuntimeTool[],
): Array<{ name: string; description: string; input_schema: unknown }> {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
}

// ─── 모듈 레벨 레지스트리(서버 권위; 브라우저는 /scenarios API로 읽음) ──────────
const REGISTRY = new Map<string, ScenarioDef>();

export function registerScenarioDef(def: ScenarioDef): void {
  REGISTRY.set(def.id, def);
}
export function unregisterScenarioDef(id: string): boolean {
  return REGISTRY.delete(id);
}
export function getScenarioDef(id: string): ScenarioDef | undefined {
  return REGISTRY.get(id);
}
export function isRegisteredScenario(id: string): boolean {
  return REGISTRY.has(id);
}
export function listScenarioDefs(source?: "builtin" | "custom"): ScenarioDef[] {
  const all = [...REGISTRY.values()];
  return source ? all.filter((d) => d.source === source) : all;
}
/** 테스트 전용. */
export function clearRegisteredScenarios(): void {
  REGISTRY.clear();
}
