/**
 * Model-family inference + best-practice sampling presets for local bench runs.
 * Values are sourced from vendor/Unsloth/HF model cards (temperature/top_p/top_k, etc.).
 */

export type LlmProfileFamily =
  | "gemma4"
  | "qwen35"
  | "qwen36"
  | "gpt_oss"
  | "minimax"
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
  /**
   * Stop strings sent to OpenAI-compatible backends as `stop`. Only set for families whose
   * turn terminator is known (Qwen ChatML `<|im_end|>`) — belt-and-suspenders against runaway
   * generation in single-turn bench. Left undefined where the terminator is unconfirmed.
   */
  stopSequences?: string[];
};

/**
 * Single source for thinking-block detection (strip + UI partition).
 * - Qwen3 standard <think>...</think> (HTML-style tag)
 * - Qwen-style redacted / think tokens
 * - LM Studio "channel" thought wrappers (see partition tests for samples)
 *
 * Ordering matters for alternation: more specific patterns first.
 * REDACTED_THINK_BLOCK ends with </think>, so it must precede the plain
 * <think>…</think> arm to avoid the latter stealing a partial match.
 */
const REDACTED_THINK_BLOCK =
  "<" + "redacted" + "_" + "thinking" + ">" + "[\\s\\S]*?" + "</" + "think" + ">";

export const THINK_BLOCK_PATTERN_SOURCE =
  REDACTED_THINK_BLOCK +
  "|<think>[\\s\\S]*?</think>" +
  "|<\\|think\\|>[\\s\\S]*?(?:<\\|end_of_thought\\|>|<\\|end\\|>|<\\|start_header_id\\|>|<\\|im_end\\|>|$)" +
  "|<\\|channel\\|>thought[\\s\\S]*?<channel\\|>" +
  "|<\\|channel>thought[\\s\\S]*?<channel\\|>";

export const THINK_BLOCK_RE = new RegExp(THINK_BLOCK_PATTERN_SOURCE, "gi");

function thinkBlockMatcher(): RegExp {
  return new RegExp(THINK_BLOCK_PATTERN_SOURCE, "gi");
}

export function stripThinkingBlocks(text: string): string {
  if (!text) return text;
  return text.replace(thinkBlockMatcher(), "").trim();
}

/** Extracts thinking spans vs remainder for UI (e.g. scenario detail). */
export function partitionThinkingBlocks(text: string): { thinking: string; response: string } {
  if (!text) return { thinking: "", response: "" };
  const re = thinkBlockMatcher();
  const spans: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) spans.push(m[0]);
  const response = text.replace(thinkBlockMatcher(), "").trim();
  return {
    thinking: spans.join("\n\n").trim(),
    response,
  };
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
    stopSequences: ["<|im_end|>"],
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
    stopSequences: ["<|im_end|>"],
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
    id: "minimax",
    version: 2,
    /** MiniMax 벤더·HF/Unsloth 등 모든 MiniMax 계열 모델 id (M2.7 외 포함) */
    match: [/minimax/i],
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
    version: 2,
    match: [/nemotron[-_]?3/i],
    presets: {
      default: { temperature: 0.6, top_p: 0.95 },
      thinking_general: { temperature: 0.6, top_p: 0.95 },
      thinking_coding: { temperature: 0.6, top_p: 0.95 },
      nonthinking_general: { temperature: 0.2, top_k: 1 },
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
  /** Stop strings to send as OpenAI `stop` (family-specific; see LlmProfileDefinition.stopSequences) */
  stopSequences?: string[];
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
  /**
   * When UI/server profile is not `auto`, use this family instead of inferring from `modelId`
   * (sampling, extra_body, prompt rules).
   */
  profileFamilyOverride?: LlmProfileFamily | null;
}): ResolvedBenchProfile {
  const family =
    input.profileFamilyOverride != null
      ? input.profileFamilyOverride
      : inferLlmProfileFamily(input.modelId);
  const def = getLlmProfileDefinition(family);
  const preset =
    input.presetOverride && input.presetOverride !== "default"
      ? input.presetOverride
      : pickPresetName({ family, taskMode: input.taskMode, thinking: input.thinkingIntent });

  const baseSampling: SamplingParams =
    def?.presets[preset] ?? def?.presets.default ?? { temperature: 0.2, top_p: 1.0 };
  const sampling: SamplingParams = { ...baseSampling, ...(input.samplingOverrides ?? {}) };

  let extraBody: Record<string, unknown> = {};
  if (
    (family === "qwen35" || family === "qwen36" || family === "nemotron3") &&
    input.thinkingIntent === "off"
  ) {
    extraBody = deepMergeObjects(extraBody, { chat_template_kwargs: { enable_thinking: false } });
  }
  if (family === "qwen36" && input.preserveThinking) {
    extraBody = deepMergeObjects(extraBody, { chat_template_kwargs: { preserve_thinking: true } });
  }
  if (family === "minimax") {
    extraBody = deepMergeObjects(extraBody, { reasoning_split: true });
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
    family === "gpt_oss" ? (input.reasoningEffort ?? "medium") : undefined;

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
    stopSequences: def?.stopSequences,
  };
}
