import type { BenchRunMeta, BenchTaskMode, LlmProfileFamily, ThinkingIntent } from "@llm-bench/shared";
import { thinkingBudgetTokens } from "./anthropic-fetch.js";
import {
  resolveBenchProfile,
  type ReasoningEffort,
  type SamplingParams,
  type SamplingPresetName,
} from "@llm-bench/shared";

export type BenchProfileRequestFields = {
  profileId?: LlmProfileFamilyOrAuto;
  taskMode?: BenchTaskMode;
  thinkingIntent?: ThinkingIntent;
  preserveThinking?: boolean;
  presetOverride?: SamplingPresetName | null;
  samplingOverrides?: Partial<SamplingParams> | null;
  reasoningEffort?: ReasoningEffort | null;
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

/**
 * Anthropic messages API 요청에 주입할 추가 필드.
 * `openAiExtrasFromMeta`와 동일 소스에서 파생하되 Anthropic 규약에 맞게 조정한다.
 * - stop 시퀀스: Anthropic은 `stop_sequences` (OpenAI는 `stop`)
 * - reasoning_effort: OpenAI 전용이므로 포함하지 않음
 * - extra_body 스프레드: chat_template_kwargs(enable_thinking 등) 포함 — LM Studio 확장
 */
export function anthropicExtrasFromMeta(meta: BenchRunMeta): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const s = meta.effective_sampling;
  if (s?.top_p != null) out.top_p = s.top_p;
  if (s?.top_k != null) out.top_k = s.top_k;
  if (s?.min_p != null) out.min_p = s.min_p;
  if (s?.repetition_penalty != null) out.repetition_penalty = s.repetition_penalty;
  if (s?.frequency_penalty != null) out.frequency_penalty = s.frequency_penalty;
  if (meta.stop && meta.stop.length > 0) out.stop_sequences = meta.stop;
  if (meta.extra_body && typeof meta.extra_body === "object") {
    return { ...out, ...meta.extra_body };
  }
  return out;
}

/**
 * #173: Anthropic `messages` 라우트에 실을 extended thinking 요청.
 *
 * 이걸 안 보내면 LM Studio의 `/v1/messages`는 추론을 스트림에 내보내지 않는다 — 모델에 따라
 * 추론을 생성하고 델타를 버리거나(전용 추론 모델), 아예 추론을 하지 않는다(하이브리드). 어느 쪽이든
 * `chat_completions`(= `reasoning_content`를 흘림)와 **다른 것을 측정**하게 되고, TTFT가 추론
 * 구간을 통째로 삼켜 60배까지 벌어졌다.
 *
 * 프로필이 사고 OFF면 null — 프로필 의도를 뒤집지 않는다.
 * `max_tokens`가 작아 `1024 ≤ budget_tokens < max_tokens`를 못 맞추면 null(필드 생략).
 */
export function anthropicThinkingFromMeta(
  meta: BenchRunMeta,
  maxTokens: number,
): { type: "enabled"; budget_tokens: number } | null {
  if (meta.profile_thinking_intent === "off") return null;
  const budget = thinkingBudgetTokens(maxTokens);
  return budget == null ? null : { type: "enabled", budget_tokens: budget };
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
