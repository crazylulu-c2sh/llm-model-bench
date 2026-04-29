import { describe, expect, it } from "vitest";
import { resolveBenchProfile } from "./llm-profiles.js";

describe("resolveBenchProfile", () => {
  it("merges reasoning_split for minimax_m27 by model id", () => {
    const r = resolveBenchProfile({
      modelId: "MiniMax-M2.7",
      taskMode: "general",
      thinkingIntent: "on",
    });
    expect(r.family).toBe("minimax_m27");
    expect(r.extraBody.reasoning_split).toBe(true);
  });

  it("honors profileFamilyOverride over model id", () => {
    const r = resolveBenchProfile({
      modelId: "some/other",
      taskMode: "general",
      thinkingIntent: "on",
      profileFamilyOverride: "minimax_m27",
    });
    expect(r.family).toBe("minimax_m27");
    expect(r.extraBody.reasoning_split).toBe(true);
  });

  it("does not add reasoning_split for non-minimax families", () => {
    const r = resolveBenchProfile({
      modelId: "Qwen/Qwen3-8B",
      taskMode: "general",
      thinkingIntent: "on",
    });
    expect(r.extraBody.reasoning_split).toBeUndefined();
  });
});
