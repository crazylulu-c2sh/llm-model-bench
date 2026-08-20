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

  it("sets enable_thinking=false for Gemma 4 when thinking off", () => {
    const r = resolveBenchProfile({
      modelId: "google/gemma-4-12b-it-qat",
      taskMode: "general",
      thinkingIntent: "off",
    });
    expect(r.family).toBe("gemma4");
    expect(r.extraBody.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("omits chat_template_kwargs for Gemma 4 when thinking on", () => {
    const r = resolveBenchProfile({
      modelId: "google/gemma-4-26b-a4b-it",
      taskMode: "general",
      thinkingIntent: "on",
    });
    expect(r.family).toBe("gemma4");
    expect(r.extraBody.chat_template_kwargs).toBeUndefined();
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
  it("uses Qwen3.8 thinking preset (presence_penalty 0, not 1.5 like qwen3.5/3.6)", () => {
    const r = resolveBenchProfile({
      modelId: "Qwen/Qwen3.8-27B",
      taskMode: "general",
      thinkingIntent: "on",
    });
    expect(r.family).toBe("qwen38");
    expect(r.preset).toBe("thinking_general");
    expect(r.sampling).toEqual({
      temperature: 1.0,
      top_p: 0.95,
      top_k: 20,
      min_p: 0.0,
      presence_penalty: 0.0,
      repetition_penalty: 1.0,
    });
    expect(r.stopSequences).toEqual(["<|im_end|>"]);
    expect(r.maxTokensRecommended).toBe(262_144);
  });

  it("defaults Qwen3.8 reasoning_effort to low on both transports", () => {
    const r = resolveBenchProfile({
      modelId: "Qwen/Qwen3.8-27B",
      taskMode: "general",
      thinkingIntent: "on",
    });
    expect(r.reasoningEffort).toBe("low");
    expect(r.extraBody.chat_template_kwargs).toEqual({ reasoning_effort: "low" });
  });

  it("honors an explicit Qwen3.8 reasoning_effort on both transports", () => {
    const r = resolveBenchProfile({
      modelId: "Qwen/Qwen3.8-27B",
      taskMode: "coding",
      thinkingIntent: "on",
      reasoningEffort: "xhigh",
    });
    expect(r.reasoningEffort).toBe("xhigh");
    expect(r.extraBody.chat_template_kwargs).toEqual({ reasoning_effort: "xhigh" });
  });

  it("sets enable_thinking=false + reasoning_effort=none for Qwen3.8 when thinking off", () => {
    const r = resolveBenchProfile({
      modelId: "Qwen/Qwen3.8-27B",
      taskMode: "general",
      thinkingIntent: "off",
      // 사고를 끈 요청에서는 UI가 보낸 effort보다 none이 우선한다.
      reasoningEffort: "xhigh",
    });
    expect(r.preset).toBe("nonthinking_general");
    expect(r.sampling.temperature).toBe(0.7);
    expect(r.sampling.top_p).toBe(0.8);
    expect(r.sampling.presence_penalty).toBe(1.5);
    expect(r.reasoningEffort).toBe("none");
    expect(r.extraBody.chat_template_kwargs).toEqual({
      enable_thinking: false,
      reasoning_effort: "none",
    });
    expect(r.maxTokensRecommended).toBe(131_072);
  });

  it("merges preserve_thinking for Qwen3.8", () => {
    const r = resolveBenchProfile({
      modelId: "Qwen/Qwen3.8-27B",
      taskMode: "general",
      thinkingIntent: "on",
      preserveThinking: true,
    });
    expect(r.extraBody.chat_template_kwargs).toEqual({
      preserve_thinking: true,
      reasoning_effort: "low",
    });
  });

  it("leaves gpt-oss reasoning_effort default untouched", () => {
    const r = resolveBenchProfile({
      modelId: "openai/gpt-oss-20b",
      taskMode: "general",
      thinkingIntent: "on",
    });
    expect(r.family).toBe("gpt_oss");
    expect(r.reasoningEffort).toBe("medium");
    expect(r.extraBody.chat_template_kwargs).toBeUndefined();
  });

  it("does not treat Qwen3-8B as Qwen3.8", () => {
    const r = resolveBenchProfile({
      modelId: "Qwen/Qwen3-8B",
      taskMode: "general",
      thinkingIntent: "on",
    });
    expect(r.family).toBe("unknown");
    expect(r.reasoningEffort).toBeUndefined();
  });
});
