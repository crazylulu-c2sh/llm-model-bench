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

  const profileFamilyOverride =
    input.profile.profileId != null && input.profile.profileId !== "auto"
      ? input.profile.profileId
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
    profileFamilyOverride,
  });

  // 모델카드 의도대로 `repetition_penalty`(곱셈 규약, 1.0=off)를 그대로 보존한다.
  // 과거에는 이를 OpenAI `frequency_penalty`(덧셈 규약, 0.0=off)로 값까지 그대로 옮겨, 1.0이
  // 강한 페널티로 둔갑하는 버그가 있었다. 로컬 OpenAI 호환 백엔드(LM Studio/llama.cpp/vLLM)는
  // `repetition_penalty`를 그대로 수용한다(이미 top_k/min_p도 그렇게 전달).
  const effSampling = { ...resolved.sampling };

  const nextMax = explicitMaxTokens ?? resolved.maxTokensRecommended;

  return {
    ...base,
    max_tokens: nextMax,
    temperature: resolved.sampling.temperature ?? base.temperature,
    effective_sampling: effSampling,
    stop:
      resolved.stopSequences && resolved.stopSequences.length > 0
        ? [...resolved.stopSequences]
        : undefined,
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
  if (s?.repetition_penalty != null) out.repetition_penalty = s.repetition_penalty;
  // frequency_penalty는 프리셋/override로 더 이상 생성되지 않으나(과거 meta·수동 값 호환) 있으면 그대로 전달.
  if (s?.frequency_penalty != null) out.frequency_penalty = s.frequency_penalty;
  if (meta.reasoning_effort) out.reasoning_effort = meta.reasoning_effort;
  if (meta.stop && meta.stop.length > 0) out.stop = meta.stop;
  if (meta.extra_body && typeof meta.extra_body === "object") {
    return { ...out, ...meta.extra_body };
  }
  return out;
}
