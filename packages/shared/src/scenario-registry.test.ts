import { afterEach, describe, expect, it } from "vitest";
import {
  AgentLoopSchema,
  CompletionPredicateSchema,
  RuntimeToolSchema,
  ScenarioDefSchema,
  clearRegisteredScenarios,
  getScenarioDef,
  isRegisteredScenario,
  listScenarioDefs,
  registerScenarioDef,
  runtimeToolsToAnthropic,
  runtimeToolsToOpenAi,
  type ScenarioDef,
} from "./scenario-registry";

function baseDef(overrides: Partial<ScenarioDef> = {}): ScenarioDef {
  return ScenarioDefSchema.parse({
    id: "test_scn",
    system: "sys",
    user: "usr",
    tools: [{ name: "t1", parameters: { type: "object" } }],
    ...overrides,
  });
}

afterEach(() => clearRegisteredScenarios());

describe("ScenarioDefSchema validation", () => {
  it("applies defaults (source builtin, tool description '', repeatLast true)", () => {
    const def = baseDef();
    expect(def.source).toBe("builtin");
    expect(def.tools[0]!.description).toBe("");
  });

  it("rejects bad id / tool name", () => {
    expect(ScenarioDefSchema.safeParse({ id: "Bad-Id", system: "s", user: "u" }).success).toBe(false);
    expect(RuntimeToolSchema.safeParse({ name: "has space" }).success).toBe(false);
  });

  it("CompletionPredicate requires pattern for contains/regex", () => {
    expect(CompletionPredicateSchema.safeParse({ type: "contains" }).success).toBe(false);
    expect(CompletionPredicateSchema.safeParse({ type: "contains", pattern: "x" }).success).toBe(true);
    expect(CompletionPredicateSchema.safeParse({ type: "no_tool_calls" }).success).toBe(true);
  });

  it("AgentLoop bounds maxTurns and requires ≥1 mockTool", () => {
    expect(
      AgentLoopSchema.safeParse({ maxTurns: 0, mockTools: [{ tool: "t", responses: ["a"] }], completion: { type: "no_tool_calls" } })
        .success,
    ).toBe(false);
    expect(
      AgentLoopSchema.safeParse({ maxTurns: 3, mockTools: [], completion: { type: "no_tool_calls" } }).success,
    ).toBe(false);
    expect(
      AgentLoopSchema.safeParse({
        maxTurns: 3,
        mockTools: [{ tool: "t", responses: ["a"] }],
        completion: { type: "no_tool_calls" },
      }).success,
    ).toBe(true);
  });
});

describe("registry", () => {
  it("register / get / isRegistered / list(source) / unregister / clear", () => {
    expect(isRegisteredScenario("test_scn")).toBe(false);
    registerScenarioDef(baseDef({ id: "test_scn", source: "builtin" }));
    registerScenarioDef(baseDef({ id: "custom_a", source: "custom" }));
    expect(isRegisteredScenario("test_scn")).toBe(true);
    expect(getScenarioDef("custom_a")?.source).toBe("custom");
    expect(listScenarioDefs("custom").map((d) => d.id)).toEqual(["custom_a"]);
    expect(listScenarioDefs().length).toBe(2);
    expect(new Set(listScenarioDefs("builtin").map((d) => d.id)).has("test_scn")).toBe(true);
  });
});

describe("tool converters", () => {
  it("maps RuntimeTool → OpenAI/Anthropic shapes", () => {
    const tools = [{ name: "get_x", description: "d", parameters: { type: "object", properties: {} } }];
    const oa = runtimeToolsToOpenAi(RuntimeToolSchema.array().parse(tools));
    expect(oa[0]).toMatchObject({ type: "function", function: { name: "get_x", description: "d" } });
    const an = runtimeToolsToAnthropic(RuntimeToolSchema.array().parse(tools));
    expect(an[0]).toMatchObject({ name: "get_x", input_schema: { type: "object" } });
  });
});
