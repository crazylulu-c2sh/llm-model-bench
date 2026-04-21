/**
 * Model-family inference + best-practice sampling presets for local bench runs.
 * Values are sourced from vendor/Unsloth/HF model cards (temperature/top_p/top_k, etc.).
 */

export type LlmProfileFamily =
  | "gemma4"
  | "qwen35"
  | "qwen36"
  | "gpt_oss"
  | "minimax_m27"
  | "nemotron3"
  | "qwen3_coder_next"
  | "glm47_flash"
  | "unknown";

export type BenchTaskMode = "general" | "coding" | "tool";

export type ThinkingIntent = "on" | "off";

export type SamplingPresetName =
  | "default"
  | "thinking_general"
  | "thinking_coding"
  | "nonthinking_general"
  | "tool_call";

export type SamplingParams = {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
};

export type PromptRules = {
  /** Gemma: prepend <|think|> at start of system prompt when thinking is on */
  gemmaThinkToken?: boolean;
  /** Strip common thinking trace blocks from assistant text before inserting into history */
  stripThinkingFromAssistantHistory?: boolean;
};

export type LlmProfileDefinition = {
  id: LlmProfileFamily;
  version: number;
  match: RegExp[];
  presets: Record<SamplingPresetName, SamplingParams>;
  /** Recommended max output tokens — bench defaults pick `default` unless overridden */
  recommendedMaxTokens: { default: number; complex: number };
  /** Native context upper bound (tokens) — informational / UI hint */
  contextNativeMax?: number;
  /** Suggested starting context for responsiveness */
  contextRecommendedStart?: number;
  promptRules: PromptRules;
};

const THINK_BLOCK_RE =
  /<think>[\s\S]*?<\/think>|<\|think\|>[\s\S]*?(?:<\|end_of_thought\|>|<\|end\|>|<\|start_header_id\|>|<\|im_end\|>|$)/gi;

export function stripThinkingBlocks(text: string): string {
  if (!text) return text;
  return text.replace(THINK_BLOCK_RE, "").trim();
}

export const LLM_PROFILE_DEFINITIONS: LlmProfileDefinition[] = [
  {
    id: "gemma4",
    version: 1,
    match: [/gemma[-_]?4/i, /gemma4/i],
    presets: {
      default: { temperature: 1.0, top_p: 0.95, top_k: 64 },
      thinking_general: { temperature: 1.0, top_p: 0.95, top_k: 64 },
      thinking_coding: { temperature: 1.0, top_p: 0.95, top_k: 64 },
      nonthinking_general: { temperature: 1.0, top_p: 0.95, top_k: 64 },
      tool_call: { temperature: 1.0, top_p: 0.95, top_k: 64 },
    },
    recommendedMaxTokens: { default: 4096, complex: 8192 },
    contextNativeMax: 262_144,
    contextRecommendedStart: 32_768,
    promptRules: { gemmaThinkToken: true, stripThinkingFromAssistantHistory: true },
  },
  {
    id: "qwen36",
    version: 1,
    match: [/qwen3\.?6/i],
    presets: {
      default: { temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0.0, presence_penalty: 1.5, repetition_penalty: 1.0 },
      thinking_general: {
        temperature: 1.0,
        top_p: 0.95,
        top_k: 20,
        min_p: 0.0,
        presence_penalty: 1.5,
        repetition_penalty: 1.0,
      },
      thinking_coding: {
        temperature: 0.6,
        top_p: 0.95,
        top_k: 20,
        min_p: 0.0,
        presence_penalty: 0.0,
        repetition_penalty: 1.0,
      },
      nonthinking_general: {
        temperature: 0.7,
        top_p: 0.8,
        top_k: 20,
        min_p: 0.0,
        presence_penalty: 1.5,
        repetition_penalty: 1.0,
      },
      tool_call: {
        temperature: 0.6,
        top_p: 0.95,
        top_k: 20,
        min_p: 0.0,
        presence_penalty: 0.0,
        repetition_penalty: 1.0,
      },
    },
    recommendedMaxTokens: { default: 32_768, complex: 81_920 },
    contextNativeMax: 262_144,
    contextRecommendedStart: 131_072,
    promptRules: { stripThinkingFromAssistantHistory: true },
  },
  {
    id: "qwen35",
    version: 1,
    match: [/qwen3\.?5/i],
    presets: {
      default: { temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0.0, presence_penalty: 1.5, repetition_penalty: 1.0 },
      thinking_general: {
        temperature: 1.0,
        top_p: 0.95,
        top_k: 20,
        min_p: 0.0,
        presence_penalty: 1.5,
        repetition_penalty: 1.0,
      },
      thinking_coding: {
        temperature: 0.6,
        top_p: 0.95,
        top_k: 20,
        min_p: 0.0,
        presence_penalty: 0.0,
        repetition_penalty: 1.0,
      },
      nonthinking_general: {
        temperature: 0.7,
        top_p: 0.8,
        top_k: 20,
        min_p: 0.0,
        presence_penalty: 1.5,
        repetition_penalty: 1.0,
      },
      tool_call: {
        temperature: 0.6,
        top_p: 0.95,
        top_k: 20,
        min_p: 0.0,
        presence_penalty: 0.0,
        repetition_penalty: 1.0,
      },
    },
    recommendedMaxTokens: { default: 32_768, complex: 81_920 },
    contextNativeMax: 262_144,
    contextRecommendedStart: 131_072,
    promptRules: { stripThinkingFromAssistantHistory: true },
  },
  {
    id: "gpt_oss",
    version: 1,
    match: [/gpt[-_]?oss/i, /openai\/gpt[-_]?oss/i],
    presets: {
      default: { temperature: 1.0, top_p: 1.0, top_k: 0, min_p: 0.0 },
      thinking_general: { temperature: 1.0, top_p: 1.0, top_k: 0, min_p: 0.0 },
      thinking_coding: { temperature: 1.0, top_p: 1.0, top_k: 0, min_p: 0.0 },
      nonthinking_general: { temperature: 1.0, top_p: 1.0, top_k: 0, min_p: 0.0 },
      tool_call: { temperature: 1.0, top_p: 1.0, top_k: 0, min_p: 0.0 },
    },
    recommendedMaxTokens: { default: 4096, complex: 8192 },
    contextNativeMax: 131_072,
    contextRecommendedStart: 16_384,
    promptRules: { stripThinkingFromAssistantHistory: false },
  },
  {
    id: "minimax_m27",
    version: 1,
    match: [/minimax[-_]?m2\.?7/i, /MiniMax[-_]?M2\.?7/i],
    presets: {
      default: { temperature: 1.0, top_p: 0.95, top_k: 40, min_p: 0.01 },
      thinking_general: { temperature: 1.0, top_p: 0.95, top_k: 40, min_p: 0.01 },
      thinking_coding: { temperature: 1.0, top_p: 0.95, top_k: 40, min_p: 0.01 },
      nonthinking_general: { temperature: 1.0, top_p: 0.95, top_k: 40, min_p: 0.01 },
      tool_call: { temperature: 1.0, top_p: 0.95, top_k: 40, min_p: 0.01 },
    },
    recommendedMaxTokens: { default: 4096, complex: 8192 },
    contextNativeMax: 200_000,
    contextRecommendedStart: 32_768,
    promptRules: { stripThinkingFromAssistantHistory: false },
  },
  {
    id: "nemotron3",
    version: 1,
    match: [/nemotron[-_]?3/i],
    presets: {
      default: { temperature: 1.0, top_p: 1.0 },
      thinking_general: { temperature: 1.0, top_p: 1.0 },
      thinking_coding: { temperature: 0.6, top_p: 0.95 },
      nonthinking_general: { temperature: 1.0, top_p: 1.0 },
      tool_call: { temperature: 0.6, top_p: 0.95 },
    },
    recommendedMaxTokens: { default: 8192, complex: 32_768 },
    contextNativeMax: 1_000_000,
    contextRecommendedStart: 262_144,
    promptRules: { stripThinkingFromAssistantHistory: true },
  },
  {
    id: "qwen3_coder_next",
    version: 1,
    match: [/qwen3[-_]?coder[-_]?next/i],
    presets: {
      default: { temperature: 1.0, top_p: 0.95, top_k: 40, min_p: 0.01 },
      thinking_general: { temperature: 1.0, top_p: 0.95, top_k: 40, min_p: 0.01 },
      thinking_coding: { temperature: 1.0, top_p: 0.95, top_k: 40, min_p: 0.01 },
      nonthinking_general: { temperature: 1.0, top_p: 0.95, top_k: 40, min_p: 0.01 },
      tool_call: { temperature: 1.0, top_p: 0.95, top_k: 40, min_p: 0.01 },
    },
    recommendedMaxTokens: { default: 8192, complex: 16_384 },
    contextNativeMax: 262_144,
    contextRecommendedStart: 32_768,
    promptRules: { stripThinkingFromAssistantHistory: false },
  },
  {
    id: "glm47_flash",
    version: 1,
    match: [/glm[-_]?4\.?7[-_]?flash/i],
    presets: {
      default: { temperature: 1.0, top_p: 0.95, min_p: 0.01, repetition_penalty: 1.0 },
      thinking_general: { temperature: 1.0, top_p: 0.95, min_p: 0.01, repetition_penalty: 1.0 },
      thinking_coding: { temperature: 1.0, top_p: 0.95, min_p: 0.01, repetition_penalty: 1.0 },
      nonthinking_general: { temperature: 1.0, top_p: 0.95, min_p: 0.01, repetition_penalty: 1.0 },
      tool_call: { temperature: 0.7, top_p: 1.0, min_p: 0.01, repetition_penalty: 1.0 },
    },
    recommendedMaxTokens: { default: 4096, complex: 8192 },
    contextNativeMax: 202_752,
    contextRecommendedStart: 32_768,
    promptRules: { stripThinkingFromAssistantHistory: false },
  },
];

export function inferLlmProfileFamily(modelId: string): LlmProfileFamily {
  const id = modelId.trim();
  for (const def of LLM_PROFILE_DEFINITIONS) {
    if (def.match.some((re) => re.test(id))) return def.id;
  }
  return "unknown";
}

export function getLlmProfileDefinition(family: LlmProfileFamily): LlmProfileDefinition | null {
  if (family === "unknown") return null;
  return LLM_PROFILE_DEFINITIONS.find((d) => d.id === family) ?? null;
}

function pickPresetName(input: {
  family: LlmProfileFamily;
  taskMode: BenchTaskMode;
  thinking: ThinkingIntent;
}): SamplingPresetName {
  const { family, taskMode, thinking } = input;
  if (taskMode === "tool") return "tool_call";
  if (family === "qwen3_coder_next") return "default";
  if (thinking === "off") return "nonthinking_general";
  if (taskMode === "coding") return "thinking_coding";
  return "thinking_general";
}

export type ResolvedBenchProfile = {
  family: LlmProfileFamily;
  definition: LlmProfileDefinition | null;
  preset: SamplingPresetName;
  sampling: SamplingParams;
  maxTokensRecommended: number;
  /** OpenAI-compatible `extra_body` merge (e.g. Qwen chat_template_kwargs) */
  extraBody: Record<string, unknown>;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  promptRulesApplied: PromptRules;
};

function deepMergeObjects(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && out[k] !== null && !Array.isArray(out[k])) {
      out[k] = deepMergeObjects(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function resolveBenchProfile(input: {
  modelId: string;
  taskMode: BenchTaskMode;
  thinkingIntent: ThinkingIntent;
  preserveThinking?: boolean;
  /** When set, forces preset regardless of task/thinking heuristics */
  presetOverride?: SamplingPresetName | null;
  /** Partial sampling overrides from UI */
  samplingOverrides?: Partial<SamplingParams> | null;
  maxTokensOverride?: number | null;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | null;
}): ResolvedBenchProfile {
  const family = inferLlmProfileFamily(input.modelId);
  const def = getLlmProfileDefinition(family);
  const preset =
    input.presetOverride && input.presetOverride !== "default"
      ? input.presetOverride
      : pickPresetName({ family, taskMode: input.taskMode, thinking: input.thinkingIntent });

  const baseSampling: SamplingParams =
    def?.presets[preset] ?? def?.presets.default ?? { temperature: 0.2, top_p: 1.0 };
  const sampling: SamplingParams = { ...baseSampling, ...(input.samplingOverrides ?? {}) };

  let extraBody: Record<string, unknown> = {};
  if ((family === "qwen35" || family === "qwen36") && input.thinkingIntent === "off") {
    extraBody = deepMergeObjects(extraBody, { chat_template_kwargs: { enable_thinking: false } });
  }
  if (family === "qwen36" && input.preserveThinking) {
    extraBody = deepMergeObjects(extraBody, { chat_template_kwargs: { preserve_thinking: true } });
  }

  const complexScenario =
    input.taskMode === "coding" || input.taskMode === "tool" || input.thinkingIntent === "on";
  const recommended = def?.recommendedMaxTokens ?? { default: 512, complex: 2048 };
  const maxTokensRecommended =
    input.maxTokensOverride != null && Number.isFinite(input.maxTokensOverride)
      ? Math.max(1, Math.floor(input.maxTokensOverride))
      : complexScenario
        ? recommended.complex
        : recommended.default;

  const reasoningEffort =
    family === "gpt_oss" ? (input.reasoningEffort ?? "medium") ?? "medium" : undefined;

  const promptRulesApplied: PromptRules = {
    ...(def?.promptRules ?? {}),
  };

  return {
    family,
    definition: def,
    preset,
    sampling,
    maxTokensRecommended,
    extraBody,
    reasoningEffort: reasoningEffort as ResolvedBenchProfile["reasoningEffort"],
    promptRulesApplied,
  };
}
