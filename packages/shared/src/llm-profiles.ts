/**
 * Model-family inference + best-practice sampling presets for local bench runs.
 * Values are sourced from vendor/Unsloth/HF model cards (temperature/top_p/top_k, etc.).
 */

export type LlmProfileFamily =
  | "gemma4"
  | "qwen35"
  | "qwen36"
  | "qwen38"
  | "gpt_oss"
  | "minimax"
  | "nemotron3"
  | "qwen3_coder_next"
  | "glm47_flash"
  | "unknown";

export type BenchTaskMode = "general" | "coding" | "tool";

export type ThinkingIntent = "on" | "off";

/**
 * 추론 강도. gpt-oss 계열이 쓰던 minimal~high에 Qwen3.8의 `none` / `xhigh`를 더한 합집합.
 * 유효 범위는 패밀리마다 다르다(gpt_oss: minimal|low|medium|high, qwen38: none|low|medium|xhigh) —
 * UI가 패밀리별로 선택지를 좁혀서 보내고, `resolveBenchProfile`이 미지정 시 기본값을 채운다.
 */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

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
  /**
   * 정확 매칭(`match`)이 전부 실패했을 때만 평가되는 2패스 폴백 패턴.
   * 아직 정의가 없는 후속 버전을 `unknown`(temperature 0.2 / max_tokens 512)이 아니라
   * 같은 계보의 최신 가이드로 흘려보내기 위한 것.
   * ⚠ 한 계보에서 이 필드를 갖는 정의는 **최신 하나뿐**이어야 한다. qwen39를 추가할 때는
   *   qwen38에서 지우고 qwen39로 옮길 것 — `llm-profiles.fallback.test.ts`가 보유 목록을 고정한다.
   */
  fallbackMatch?: RegExp[];
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
 * - LM Studio / Gemma 4 "channel" thought wrappers (see partition tests)
 * - GLM-4.7-Flash / Nemotron 30B: closing </think> only at string start
 *   (opening tag injected in chat template, not always present in streamed text)
 *
 * Streaming APIs may split reasoning (`reasoning_content`, `thinking_delta`, MiniMax
 * `reasoning_split`) before text reaches these helpers; inline regex is the fallback for
 * `chat_completions` combined bodies and misconfigured LM Studio parsers.
 *
 * Ordering matters for alternation: full pairs before closing-only / channel arms.
 * REDACTED_THINK_BLOCK ends with </think>, so it must precede the plain
 * <think>…</think> arm to avoid the latter stealing a partial match.
 */
const REDACTED_THINK_BLOCK =
  "<" + "redacted" + "_" + "thinking" + ">" + "[\\s\\S]*?" + "</" + "think" + ">";

/** Gemma 4 thinking-OFF (12B+): empty <|channel>thought\n prefix without <channel|> close. */
const GEMMA_ORPHAN_THOUGHT_PREFIX = /^<\|channel>thought\n\s*/i;

export const THINK_BLOCK_PATTERN_SOURCE =
  REDACTED_THINK_BLOCK +
  "|<think>[\\s\\S]*?</think>" +
  "|<\\|think\\|>[\\s\\S]*?(?:<\\|end_of_thought\\|>|<\\|end\\|>|<\\|start_header_id\\|>|<\\|im_end\\|>|$)" +
  "|<\\|channel\\|>thought[\\s\\S]*?<channel\\|>" +
  "|<\\|channel>thought[\\s\\S]*?<channel\\|>" +
  "|^[\\s\\S]*?</think>";

export const THINK_BLOCK_RE = new RegExp(THINK_BLOCK_PATTERN_SOURCE, "gi");

function thinkBlockMatcher(): RegExp {
  return new RegExp(THINK_BLOCK_PATTERN_SOURCE, "gi");
}

function peelGemmaOrphanThoughtPrefix(text: string): { rest: string; prefix: string } {
  const m = text.match(GEMMA_ORPHAN_THOUGHT_PREFIX);
  if (!m) return { rest: text, prefix: "" };
  return { rest: text.replace(GEMMA_ORPHAN_THOUGHT_PREFIX, ""), prefix: m[0] };
}

export function stripThinkingBlocks(text: string): string {
  if (!text) return text;
  const afterRegex = text.replace(thinkBlockMatcher(), "");
  return peelGemmaOrphanThoughtPrefix(afterRegex).rest.trim();
}

/** Extracts thinking spans vs remainder for UI (e.g. scenario detail). */
export function partitionThinkingBlocks(text: string): { thinking: string; response: string } {
  if (!text) return { thinking: "", response: "" };
  const re = thinkBlockMatcher();
  const spans: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) spans.push(m[0]);
  let response = text.replace(thinkBlockMatcher(), "");
  const { rest, prefix } = peelGemmaOrphanThoughtPrefix(response);
  if (prefix) spans.push(prefix);
  return {
    // Do not .trim() thinking — Gemma orphan prefix ends with \n and must stay visible in UI.
    thinking: spans.join("\n\n"),
    response: rest.trim(),
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
    id: "qwen38",
    version: 1,
    // `\.?`만 허용한다 — /qwen3[-_.]?8/로 넓히면 별개 모델인 `Qwen3-8B`를 삼킨다.
    match: [/qwen3\.?8/i],
    // 미등록 Qwen 신버전(3.9 · 4 · 4.1 …) 폴백. 구분자 없이 붙는 숫자만 버전으로 본다 —
    // `Qwen-7B`/`Qwen-72B`의 파라미터 수는 대시 뒤에 오므로 걸리지 않는다.
    // 메이저 10 이상이 나오면 이 정규식만 확장하면 된다.
    fallbackMatch: [/qwen(?:3\.\d+|[4-9](?:\.\d+)?)/i],
    stopSequences: ["<|im_end|>"],
    presets: {
      // 모델카드 thinking 권장값. qwen35/36과 달리 presence_penalty가 1.5가 아니라 0.0이다.
      default: {
        temperature: 1.0,
        top_p: 0.95,
        top_k: 20,
        min_p: 0.0,
        presence_penalty: 0.0,
        repetition_penalty: 1.0,
      },
      thinking_general: {
        temperature: 1.0,
        top_p: 0.95,
        top_k: 20,
        min_p: 0.0,
        presence_penalty: 0.0,
        repetition_penalty: 1.0,
      },
      // Qwen3.8은 코딩/일반 thinking을 나누지 않는다 — 모델카드 thinking 값을 그대로 쓴다.
      thinking_coding: {
        temperature: 1.0,
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
        temperature: 1.0,
        top_p: 0.95,
        top_k: 20,
        min_p: 0.0,
        presence_penalty: 0.0,
        repetition_penalty: 1.0,
      },
    },
    // 모델카드 권장: reasoning 262,144 / 최종 응답 131,072.
    // 컨텍스트가 짧은 백엔드(vLLM --max-model-len 등)에서는 UI max_tokens로 낮춰 쓸 것.
    recommendedMaxTokens: { default: 131_072, complex: 262_144 },
    contextNativeMax: 262_144,
    contextRecommendedStart: 131_072,
    promptRules: { stripThinkingFromAssistantHistory: true },
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
  // 2패스: 정의가 아직 없는 후속 버전을 같은 계보의 최신 가이드로 보낸다(§fallbackMatch).
  for (const def of LLM_PROFILE_DEFINITIONS) {
    if (def.fallbackMatch?.some((re) => re.test(id))) return def.id;
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
  reasoningEffort?: ReasoningEffort;
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
  reasoningEffort?: ReasoningEffort | null;
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

  // extra_body 조립보다 먼저 확정한다 — qwen38은 최상위 `reasoning_effort`와
  // `chat_template_kwargs.reasoning_effort` 양쪽에 같은 값을 실어야 하기 때문.
  const reasoningEffort: ReasoningEffort | undefined =
    family === "gpt_oss"
      ? (input.reasoningEffort ?? "medium")
      : family === "qwen38"
        ? input.thinkingIntent === "off"
          ? "none"
          : // 모델카드 기본은 xhigh이나 로컬 벤치에서 사고 토큰이 폭주해 타임아웃·오염 가드
            // 재시도를 유발한다. 하네스 기본은 low로 낮추고 UI에서 올릴 수 있게 둔다.
            (input.reasoningEffort ?? "low")
        : undefined;

  let extraBody: Record<string, unknown> = {};
  if (
    (family === "qwen35" ||
      family === "qwen36" ||
      family === "qwen38" ||
      family === "nemotron3" ||
      family === "gemma4") &&
    input.thinkingIntent === "off"
  ) {
    extraBody = deepMergeObjects(extraBody, { chat_template_kwargs: { enable_thinking: false } });
  }
  if ((family === "qwen36" || family === "qwen38") && input.preserveThinking) {
    extraBody = deepMergeObjects(extraBody, { chat_template_kwargs: { preserve_thinking: true } });
  }
  // Qwen3.8: LM Studio/llama.cpp는 chat_template_kwargs 경로로만 effort를 받는다.
  // Ollama의 OpenAI 호환 라우트는 최상위 필드를 읽으므로 두 경로 모두에 싣는다.
  if (family === "qwen38" && reasoningEffort) {
    extraBody = deepMergeObjects(extraBody, {
      chat_template_kwargs: { reasoning_effort: reasoningEffort },
    });
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
    reasoningEffort,
    promptRulesApplied,
    stopSequences: def?.stopSequences,
  };
}
