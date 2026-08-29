import { BUILTIN_AGENT_LOOP_IDS, PUBLIC_SCENARIO_IDS } from "@llm-bench/shared";
import { describe, expect, it } from "vitest";
import {
  benchPickerCatalogCount,
  isPickerBuiltinAgentId,
  PICKER_BUILTIN_AGENT_IDS,
} from "./bench-scenario-picker";

describe("benchPickerCatalogCount", () => {
  it("includes builtin agent_loop even when the scenarios API is down", () => {
    expect(PICKER_BUILTIN_AGENT_IDS).toEqual(BUILTIN_AGENT_LOOP_IDS);
    expect(PICKER_BUILTIN_AGENT_IDS.length).toBeGreaterThan(0);
    expect(benchPickerCatalogCount(0)).toBe(
      PUBLIC_SCENARIO_IDS.length + BUILTIN_AGENT_LOOP_IDS.length,
    );
    expect(isPickerBuiltinAgentId("agent_loop_mock_v1")).toBe(true);
    expect(isPickerBuiltinAgentId("chat_hello")).toBe(false);
  });
});
