import { describe, expect, it } from "vitest";
import { scoreScenario } from "./scenarios.js";

describe("scoreScenario tool_weather", () => {
  it("passes when tool_calls JSON is on its own line after assistant text", () => {
    const out = 'Here.\n{"tool_calls":[{"index":0,"type":"function","function":{"name":"get_weather","arguments":"{}"}}]}';
    expect(scoreScenario("tool_weather", out).pass).toBe(true);
  });

  it("passes on standalone tool_calls JSON", () => {
    const out = JSON.stringify({
      tool_calls: [{ function: { name: "get_weather", arguments: '{"city":"Seattle"}' } }],
    });
    expect(scoreScenario("tool_weather", out).pass).toBe(true);
  });
});
