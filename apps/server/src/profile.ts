import type { BenchRunMeta, BenchTaskMode, LlmProfileFamily, ThinkingIntent } from "@llm-bench/shared";
import { resolveBenchProfile, type SamplingParams, type SamplingPresetName } from "@llm-bench/shared";

export type BenchProfileRequestFields = {
  profileId?: LlmProfileFamilyOrAuto;
  taskMode?: BenchTaskMode;
  thinkingIntent?: ThinkingIntent;
  preserveThinking?: boolean;
  presetOverride?: SamplingPresetName | null;
  samplingOverrides?: Partial<SamplingParams> | null;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | null;
  /**
   * 출력 상한(토큰). `BenchRequest.profileMaxTokens`와 동일 목적이며,
   * 한쪽만 넣어도 됩니다. 둘 다 있으면 `profileMaxTokens`(요청 상위 필드)가 우선합니다.
   */
  maxTokensOverride?: number | null;
};

type LlmProfileFamilyOrAuto = "auto" | LlmProfileFamily;

export function buildProfileAugmentedMeta(
  base: BenchRunMeta,
  input: {
    modelId: string;
    profile: BenchProfileRequestFields;
    profileMaxTokens?: number | null;
  },
): BenchRunMeta {
  const taskMode = input.profile.taskMode ?? "general";
  const thinkingIntent = input.profile.thinkingIntent ?? "on";
  const auto = input.profile.profileId == null || input.profile.profileId === "auto";
  const family = auto ? undefined : input.profile.profileId;

  const explicitMaxTokens =
    input.profileMaxTokens != null && Number.isFinite(input.profileMaxTokens) && input.profileMaxTokens > 0
      ? Math.floor(input.profileMaxTokens)
      : input.profile.maxTokensOverride != null &&
          Number.isFinite(input.profile.maxTokensOverride) &&
          input.profile.maxTokensOverride > 0
        ? Math.floor(input.profile.maxTokensOverride)
        : null;

  const resolved = resolveBenchProfile({
    modelId: input.modelId,
    taskMode,
    thinkingIntent,
    preserveThinking: !!input.profile.preserveThinking,
    presetOverride: input.profile.presetOverride,
    samplingOverrides: input.profile.samplingOverrides,
    maxTokensOverride: explicitMaxTokens,
    reasoningEffort: input.profile.reasoningEffort,
  });

  const { repetition_penalty, ...restSampling } = resolved.sampling;
  const effSampling = {
    ...restSampling,
    ...(repetition_penalty != null ? { frequency_penalty: repetition_penalty } : {}),
  };

  const nextMax = explicitMaxTokens ?? resolved.maxTokensRecommended;

  return {
    ...base,
    max_tokens: nextMax,
    temperature: resolved.sampling.temperature ?? base.temperature,
    effective_sampling: effSampling,
    extra_body: Object.keys(resolved.extraBody).length ? resolved.extraBody : undefined,
    reasoning_effort: resolved.reasoningEffort,
    profile_id: family === "unknown" ? "unknown" : (family ?? resolved.family),
    profile_version: resolved.definition?.version,
    profile_preset: resolved.preset,
    profile_task_mode: taskMode,
    profile_thinking_intent: thinkingIntent,
    profile_preserve_thinking: input.profile.preserveThinking,
    prompt_rules_applied: resolved.promptRulesApplied,
  };
}

export function openAiExtrasFromMeta(meta: BenchRunMeta): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const s = meta.effective_sampling;
  if (s?.top_p != null) out.top_p = s.top_p;
  if (s?.top_k != null) out.top_k = s.top_k;
  if (s?.min_p != null) out.min_p = s.min_p;
  if (s?.presence_penalty != null) out.presence_penalty = s.presence_penalty;
  if (s?.frequency_penalty != null) out.frequency_penalty = s.frequency_penalty;
  if (meta.reasoning_effort) out.reasoning_effort = meta.reasoning_effort;
  if (meta.extra_body && typeof meta.extra_body === "object") {
    return { ...out, ...meta.extra_body };
  }
  return out;
}
