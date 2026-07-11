import { describe, expect, it } from "vitest";
import {
  AGENT_LOOP_BUDGET_V1,
  AGENT_LOOP_MOCK_V1,
  BUILTIN_AGENT_LOOP_IDS,
} from "./agent-loop-builtin";
import { getScenarioDef, isRegisteredScenario } from "./scenario-registry";

describe("builtin agent_loop scenarios (#79/#101)", () => {
  it("agent_loop_budget_v1 mirrors mock_v1 but tightens per-turn max_tokens to 256", () => {
    expect(AGENT_LOOP_BUDGET_V1.id).toBe("agent_loop_budget_v1");
    // 예산만 다르고 나머지(스크립트·도구·판정)는 동일해야 한다.
    expect(AGENT_LOOP_BUDGET_V1.sampling?.max_tokens).toBe(256);
    expect(AGENT_LOOP_MOCK_V1.sampling?.max_tokens).toBe(640);
    expect(AGENT_LOOP_BUDGET_V1.tools).toBe(AGENT_LOOP_MOCK_V1.tools);
    expect(AGENT_LOOP_BUDGET_V1.agentLoop).toBe(AGENT_LOOP_MOCK_V1.agentLoop);
    expect(AGENT_LOOP_BUDGET_V1.judge).toBe(AGENT_LOOP_MOCK_V1.judge);
    expect(AGENT_LOOP_BUDGET_V1.source).toBe("builtin");
  });

  it("is registered (importing the module registers it) and listed in BUILTIN_AGENT_LOOP_IDS", () => {
    expect(isRegisteredScenario("agent_loop_budget_v1")).toBe(true);
    expect(getScenarioDef("agent_loop_budget_v1")?.agentLoop).toBeDefined();
    expect(BUILTIN_AGENT_LOOP_IDS).toContain("agent_loop_budget_v1");
    expect(BUILTIN_AGENT_LOOP_IDS).toContain("agent_loop_mock_v1");
  });
});
