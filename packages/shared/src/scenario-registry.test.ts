import { afterEach, describe, expect, it } from "vitest";
import {
  AgentLoopSchema,
  CompletionPredicateSchema,
  CustomScenarioInputSchema,
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

  it("#105 MockTool argDispatch: 선택 필드로 파싱, responses는 여전히 필수(하위호환)", () => {
    // argDispatch 있어도 responses 필수 — 스키마 하위호환 + 커스텀 mock-coverage 불변식 유지.
    expect(
      AgentLoopSchema.safeParse({
        maxTurns: 3,
        mockTools: [
          {
            tool: "read_document",
            responses: ["unused"],
            argDispatch: { argKey: "id", cases: { doc_aes: "AES" }, fallback: '{"error":"x"}' },
          },
        ],
        completion: { type: "no_tool_calls" },
      }).success,
    ).toBe(true);
    // argDispatch 미지정도 그대로 유효(기존 시퀀스 mock).
    expect(
      AgentLoopSchema.safeParse({
        maxTurns: 3,
        mockTools: [{ tool: "t", responses: ["a"] }],
        completion: { type: "no_tool_calls" },
      }).success,
    ).toBe(true);
    // argKey 누락은 거부.
    expect(
      AgentLoopSchema.safeParse({
        maxTurns: 3,
        mockTools: [{ tool: "t", responses: ["a"], argDispatch: { cases: { a: "b" } } }],
        completion: { type: "no_tool_calls" },
      }).success,
    ).toBe(false);
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

describe("CustomScenarioInputSchema (#83)", () => {
  const valid = { id: "my_wiki_task", system: "s", user: "u", judge: { criterion: "score it" } };

  it("accepts a valid single-turn custom scenario (judge required)", () => {
    expect(CustomScenarioInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects when judge is missing", () => {
    expect(CustomScenarioInputSchema.safeParse({ id: "my_task", system: "s", user: "u" }).success).toBe(false);
  });

  it("rejects ids that collide with a built-in namespace prefix", () => {
    for (const id of ["vision_x", "stress_y", "agent_z", "chat_q", "tool_w"]) {
      expect(CustomScenarioInputSchema.safeParse({ ...valid, id }).success).toBe(false);
    }
  });

  it("rejects an agent_loop custom scenario whose declared tool has no mock", () => {
    const bad = {
      ...valid,
      id: "my_agent",
      tools: [{ name: "t1" }],
      agentLoop: { maxTurns: 3, mockTools: [{ tool: "other", responses: ["x"] }], completion: { type: "no_tool_calls" } },
    };
    expect(CustomScenarioInputSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts an agent_loop custom scenario with a mock for every declared tool", () => {
    const ok = {
      ...valid,
      id: "my_agent",
      tools: [{ name: "t1" }],
      agentLoop: { maxTurns: 3, mockTools: [{ tool: "t1", responses: ["x"] }], completion: { type: "no_tool_calls" } },
    };
    expect(CustomScenarioInputSchema.safeParse(ok).success).toBe(true);
  });

  it("does not carry a client-supplied source (omitted)", () => {
    const parsed = CustomScenarioInputSchema.parse({ ...valid, source: "builtin" } as Record<string, unknown>);
    expect("source" in parsed).toBe(false);
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
