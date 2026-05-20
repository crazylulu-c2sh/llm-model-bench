import { describe, expect, it } from "vitest";
import { resolveBenchProfile } from "./llm-profiles.js";

describe("resolveBenchProfile", () => {
  it("merges reasoning_split for MiniMax by model id (M2.7)", () => {
    const r = resolveBenchProfile({
      modelId: "MiniMax-M2.7",
      taskMode: "general",
      thinkingIntent: "on",
    });
    expect(r.family).toBe("minimax");
    expect(r.extraBody.reasoning_split).toBe(true);
  });

  it("merges reasoning_split for other MiniMax model ids", () => {
    const r = resolveBenchProfile({
      modelId: "MiniMax-M2",
      taskMode: "general",
      thinkingIntent: "on",
    });
    expect(r.family).toBe("minimax");
    expect(r.extraBody.reasoning_split).toBe(true);
  });

  it("honors profileFamilyOverride over model id", () => {
    const r = resolveBenchProfile({
      modelId: "some/other",
      taskMode: "general",
      thinkingIntent: "on",
      profileFamilyOverride: "minimax",
    });
    expect(r.family).toBe("minimax");
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

  it("sets enable_thinking=false for Nemotron 3 when thinking off", () => {
    const r = resolveBenchProfile({
      modelId: "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16",
      taskMode: "general",
      thinkingIntent: "off",
    });
    expect(r.family).toBe("nemotron3");
    expect(r.preset).toBe("nonthinking_general");
    expect(r.extraBody.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(r.sampling.temperature).toBe(0.2);
    expect(r.sampling.top_k).toBe(1);
  });

  it("omits chat_template_kwargs for Nemotron 3 when thinking on", () => {
    const r = resolveBenchProfile({
      modelId: "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16",
      taskMode: "general",
      thinkingIntent: "on",
    });
    expect(r.family).toBe("nemotron3");
    expect(r.preset).toBe("thinking_general");
    expect(r.extraBody.chat_template_kwargs).toBeUndefined();
    expect(r.sampling.temperature).toBe(0.6);
    expect(r.sampling.top_p).toBe(0.95);
  });
});
