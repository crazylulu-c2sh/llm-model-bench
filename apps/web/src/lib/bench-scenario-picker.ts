import { BUILTIN_AGENT_LOOP_IDS, PUBLIC_SCENARIO_IDS } from "@llm-bench/shared";

const BUILTIN_AGENT_SET = new Set<string>(BUILTIN_AGENT_LOOP_IDS);

/** 서버 페치 없이 벤치 피커에 항상 보이는 빌트인 agent_loop id. */
export const PICKER_BUILTIN_AGENT_IDS: readonly string[] = BUILTIN_AGENT_LOOP_IDS;

export function isPickerBuiltinAgentId(id: string): boolean {
  return BUILTIN_AGENT_SET.has(id);
}

/** 공개(텍스트+비전) + 빌트인 에이전트 + 사용자 커스텀. API 실패해도 분모가 18로 줄지 않는다. */
export function benchPickerCatalogCount(customCount = 0): number {
  return PUBLIC_SCENARIO_IDS.length + BUILTIN_AGENT_LOOP_IDS.length + Math.max(0, customCount);
}
