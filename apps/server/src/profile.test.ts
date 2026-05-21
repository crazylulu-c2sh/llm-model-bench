import { describe, expect, it } from "vitest";
import { buildProfileAugmentedMeta, openAiExtrasFromMeta } from "./profile.js";
import type { BenchRunMeta, DetectResult } from "@llm-bench/shared";

const dummyDetect = {
  baseUrl: "http://127.0.0.1:1234",
  provider: "lm_studio",
  models: [],
  steps: [],
  capabilities: { openaiChat: true, anthropicMessages: false },
} as DetectResult;

function baseMeta(modelId: string): BenchRunMeta {
  return {
    run_id: "run_test",
    base_url: "http://127.0.0.1:1234",
    provider: "lm_studio",
    model_id: modelId,
    api_routes: ["chat_completions"],
    scenario_ids: ["chat_hello"],
    scenario_bundle_version: "4",
    temperature: 0.2,
    max_tokens: 512,
    parallel: false,
    warmup_runs: 1,
    measured_runs: 1,
    created_at: new Date().toISOString(),
  };
}

describe("buildProfileAugmentedMeta", () => {
  it("applies Qwen3.6 thinking_general preset and extra_body for thinking off", () => {
    const meta = buildProfileAugmentedMeta(baseMeta("Qwen/Qwen3.6-35B-A3B"), {
      modelId: "Qwen/Qwen3.6-35B-A3B",
      profile: {
        profileId: "auto",
        taskMode: "general",
        thinkingIntent: "off",
        preserveThinking: false,
      },
      profileMaxTokens: null,
    });
    expect(meta.profile_preset).toBe("nonthinking_general");
    expect(meta.extra_body?.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(meta.effective_sampling?.top_k).toBe(20);
    expect(meta.max_tokens).toBeGreaterThan(1000);
  });

  it("adds preserve_thinking for Qwen3.6 when enabled", () => {
    const meta = buildProfileAugmentedMeta(baseMeta("Qwen/Qwen3.6-35B-A3B"), {
      modelId: "Qwen/Qwen3.6-35B-A3B",
      profile: {
        taskMode: "general",
        thinkingIntent: "on",
        preserveThinking: true,
      },
      profileMaxTokens: 1234,
    });
    expect(meta.extra_body?.chat_template_kwargs).toMatchObject({ preserve_thinking: true });
    expect(meta.max_tokens).toBe(1234);
  });

  it("maps repetition_penalty to frequency_penalty in effective_sampling", () => {
    const meta = buildProfileAugmentedMeta(baseMeta("Qwen/Qwen3.6-35B-A3B"), {
      modelId: "Qwen/Qwen3.6-35B-A3B",
      profile: { taskMode: "general", thinkingIntent: "on" },
      profileMaxTokens: null,
    });
    expect(meta.effective_sampling?.presence_penalty).toBe(1.5);
    expect(meta.effective_sampling?.frequency_penalty).toBe(1.0);
  });

  it("uses MiniMax-style defaults for minimax ids", () => {
    const meta = buildProfileAugmentedMeta(baseMeta("unsloth/MiniMax-M2.7-GGUF"), {
      modelId: "unsloth/MiniMax-M2.7-GGUF",
      profile: { taskMode: "general", thinkingIntent: "on" },
      profileMaxTokens: null,
    });
    expect(meta.profile_id).toBe("minimax");
    expect(meta.effective_sampling?.top_k).toBe(40);
    expect(meta.effective_sampling?.min_p).toBe(0.01);
    expect(meta.extra_body?.reasoning_split).toBe(true);
  });

  it("adds reasoning_split when profile forces minimax on a non-minimax model id", () => {
    const meta = buildProfileAugmentedMeta(baseMeta("some/Tiny-Model"), {
      modelId: "some/Tiny-Model",
      profile: { profileId: "minimax", taskMode: "general", thinkingIntent: "on" },
      profileMaxTokens: null,
    });
    expect(meta.profile_id).toBe("minimax");
    expect(meta.extra_body?.reasoning_split).toBe(true);
  });

  it("applies Nemotron3 nonthinking_general preset and extra_body for thinking off", () => {
    const meta = buildProfileAugmentedMeta(
      baseMeta("nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16"),
      {
        modelId: "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16",
        profile: {
          profileId: "auto",
          taskMode: "general",
          thinkingIntent: "off",
          preserveThinking: false,
        },
        profileMaxTokens: null,
      },
    );
    expect(meta.profile_id).toBe("nemotron3");
    expect(meta.profile_preset).toBe("nonthinking_general");
    expect(meta.extra_body?.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(meta.effective_sampling?.temperature).toBe(0.2);
    expect(meta.effective_sampling?.top_k).toBe(1);
  });

  it("Nemotron3 thinking on omits enable_thinking and uses thinking_general preset", () => {
    const meta = buildProfileAugmentedMeta(
      baseMeta("nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16"),
      {
        modelId: "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16",
        profile: { taskMode: "general", thinkingIntent: "on" },
        profileMaxTokens: null,
      },
    );
    expect(meta.profile_id).toBe("nemotron3");
    expect(meta.profile_preset).toBe("thinking_general");
    expect(meta.extra_body?.chat_template_kwargs).toBeUndefined();
    expect(meta.effective_sampling?.temperature).toBe(0.6);
    expect(meta.effective_sampling?.top_p).toBe(0.95);
  });
});

describe("openAiExtrasFromMeta", () => {
  it("merges extra_body on top of sampling extras", () => {
    const meta: BenchRunMeta = {
      ...baseMeta("x"),
      effective_sampling: { top_p: 0.95, top_k: 40, min_p: 0.01 },
      extra_body: { chat_template_kwargs: { enable_thinking: false } },
    };
    const merged = openAiExtrasFromMeta(meta);
    expect(merged.top_p).toBe(0.95);
    expect(merged.top_k).toBe(40);
    expect(merged.min_p).toBe(0.01);
    expect(merged.chat_template_kwargs).toEqual({ enable_thinking: false });
  });
});
