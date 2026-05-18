import { z } from "zod";

export {
  ALL_SCENARIO_IDS,
  PUBLIC_SCENARIO_IDS,
  STRESS_WORKLOAD_IDS,
  defaultMaxTokensForWorkload,
  expectedScriptForWorkload,
  getScenarioSystemPromptPreview,
  getScenarioUserPromptPreview,
  isScenarioId,
  isStressWorkloadId,
  type ScenarioId,
  type ScenarioPromptPreviewOpts,
  type StressWorkloadId,
} from "./scenarios-preview";

export { getScenarioBenchMeta, type ScenarioBenchMeta } from "./scenario-meta";

export { approxOutputTokens, tokensPerSecondFromRun } from "./tps";

export {
  STRESS_MAX_LIVE_CELLS,
  StressRampConfigSchema,
  type StressApiRoute,
  type StressProviderKind,
  type StressRampConfig,
  type StressResolvedProfile,
  type StressResult,
  type StressRunDetailResponse,
  type StressRunFilterOptions,
  type StressRunListItem,
  type StressRunMeta,
  type StressRunStatus,
  type StressRunsListResponse,
  type StressScriptMatch,
  type StressStageLatencyMs,
  type StressStageResult,
  type StressStreamEvent,
  type StressTpsSource,
} from "./stress";

export {
  inferLlmProfileFamily,
  resolveBenchProfile,
  stripThinkingBlocks,
  partitionThinkingBlocks,
  THINK_BLOCK_PATTERN_SOURCE,
  THINK_BLOCK_RE,
  LLM_PROFILE_DEFINITIONS,
  type BenchTaskMode,
  type LlmProfileFamily,
  type LlmProfileDefinition,
  type PromptRules,
  type ResolvedBenchProfile,
  type SamplingParams,
  type SamplingPresetName,
  type ThinkingIntent,
} from "./llm-profiles";

export const SamplingParamsSchema = z.object({
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  top_k: z.number().optional(),
  min_p: z.number().optional(),
  presence_penalty: z.number().optional(),
  repetition_penalty: z.number().optional(),
});

export const ProviderKindSchema = z.enum([
  "lm_studio",
  "ollama",
  "openai_compatible",
  "manual",
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const DetectStepSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  status: z.number().optional(),
  detail: z.string().optional(),
});
export type DetectStep = z.infer<typeof DetectStepSchema>;

/** 목록 API·네트워크 도달 여부(선택 — 구버전 응답에는 없을 수 있음) */
export const ReachabilitySchema = z.object({
  ok: z.boolean(),
  state: z.enum(["ok", "unreachable", "partial"]),
  reason: z.string().optional(),
});
export type Reachability = z.infer<typeof ReachabilitySchema>;

export const LmStudioModelSchema = z.object({
  key: z.string(),
  type: z.enum(["llm", "embedding"]).optional(),
  display_name: z.string().optional(),
  loaded_instances: z.array(z.unknown()).optional(),
});
export type LmStudioModel = z.infer<typeof LmStudioModelSchema>;

export const DetectResultSchema = z.object({
  provider: ProviderKindSchema,
  baseUrl: z.string().url(),
  models: z.array(
    z.object({
      id: z.string(),
      label: z.string().optional(),
      kind: z.string().optional(),
      /** 디스크/가중치 용량 등 (바이트) — LM Studio·Ollama 등에서 제공 시 */
      size_bytes: z.number().optional(),
      /** 파라미터 규모 힌트 (예: 7B) — LM Studio `params_string` 등 */
      params_string: z.string().optional(),
    }),
  ),
  steps: z.array(DetectStepSchema),
  capabilities: z.object({
    openaiChat: z.boolean(),
    anthropicMessages: z.boolean(),
  }),
  reachability: ReachabilitySchema.optional(),
});
export type DetectResult = z.infer<typeof DetectResultSchema>;

export const BenchRunMetaSchema = z.object({
  run_id: z.string(),
  app_version: z.string().optional(),
  git_commit: z.string().optional(),
  base_url: z.string(),
  provider: ProviderKindSchema,
  model_id: z.string(),
  api_routes: z.array(z.enum(["chat_completions", "messages"])),
  scenario_ids: z.array(z.string()),
  scenario_bundle_version: z.string(),
  temperature: z.number(),
  max_tokens: z.number(),
  /** Applied sampling (subset sent upstream depending on route) */
  effective_sampling: z
    .object({
      temperature: z.number().optional(),
      top_p: z.number().optional(),
      top_k: z.number().optional(),
      min_p: z.number().optional(),
      presence_penalty: z.number().optional(),
      frequency_penalty: z.number().optional(),
      repetition_penalty: z.number().optional(),
    })
    .optional(),
  /** OpenAI-compatible servers: merged into request JSON */
  extra_body: z.record(z.unknown()).optional(),
  /** gpt-oss style deployments */
  reasoning_effort: z.enum(["minimal", "low", "medium", "high"]).optional(),
  profile_id: z.string().optional(),
  profile_version: z.number().optional(),
  profile_preset: z.string().optional(),
  profile_task_mode: z.enum(["general", "coding", "tool"]).optional(),
  profile_thinking_intent: z.enum(["on", "off"]).optional(),
  profile_preserve_thinking: z.boolean().optional(),
  prompt_rules_applied: z
    .object({
      gemmaThinkToken: z.boolean().optional(),
      stripThinkingFromAssistantHistory: z.boolean().optional(),
    })
    .optional(),
  seed: z.number().nullable().optional(),
  parallel: z.boolean(),
  warmup_runs: z.number(),
  measured_runs: z.number(),
  /** LM Studio: 벤치 대상 외 감지 모델에 unload 시도 여부 */
  unload_other_models: z.boolean().optional(),
  /** LM Studio: 이번 런이 모델을 로드한 경우에만 끝날 때 unload 시도 여부 */
  auto_unload_after_bench: z.boolean().optional(),
  /** Vite 등에서 서빙하는 public 자산 베이스 (예: http://127.0.0.1:21104) — nist.fips.197.pdf URL 허용용 */
  public_assets_origin: z.string().optional(),
  created_at: z.string(),
});
export type BenchRunMeta = z.infer<typeof BenchRunMetaSchema>;

export const StreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run_started"),
    run_id: z.string(),
    /** 있으면 DB/클라이언트가 동일 스냅샷으로 사용 */
    meta: BenchRunMetaSchema.optional(),
  }),
  z.object({
    type: z.literal("model_loaded"),
    model_id: z.string(),
    provider: ProviderKindSchema,
    /** LM Studio 전용: 실제 POST load 여부 / 이미 메모리 / skipModelLoad */
    lm_studio_prepare: z
      .enum(["loaded", "already_in_memory", "load_skipped_by_request"])
      .optional(),
  }),
  z.object({
    type: z.literal("model_unloaded"),
    model_id: z.string(),
    /** 예: 벤치 종료 후 자동 언로드 */
    phase: z.literal("after_bench").optional(),
    ok: z.boolean(),
    status: z.number().optional(),
  }),
  z.object({
    type: z.literal("scenario_start"),
    scenario_id: z.string(),
    api_route: z.enum(["chat_completions", "messages"]),
    /** 실제 system 메시지 — 라이브 UI 상세와 요청 정합용 */
    system_prompt: z.string().optional(),
    /** 실제 user 메시지 — 라이브 UI 상세와 요청 정합용 */
    user_prompt: z.string().optional(),
  }),
  z.object({
    type: z.literal("token_delta"),
    scenario_id: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("scenario_end"),
    scenario_id: z.string(),
    api_route: z.enum(["chat_completions", "messages"]).optional(),
    metrics: z.object({
      ttft_ms: z.number().nullable().optional(),
      tpot_ms: z.number().nullable().optional(),
      total_ms: z.number(),
      output_chars: z.number(),
      approx_tokens: z.number().optional(),
      stream_completed: z.boolean(),
    }),
    quality: z
      .object({
        pass: z.boolean(),
        score: z.number().optional(),
        reason: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("metrics_update"),
    aggregate: z.record(z.unknown()),
  }),
  z.object({ type: z.literal("run_finished"), run_id: z.string() }),
  z.object({
    type: z.literal("error"),
    layer: z.enum(["upstream", "downstream", "orchestrator"]),
    code: z.string(),
    message: z.string(),
    partial: z.record(z.unknown()).optional(),
  }),
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;

export const BenchResultSchema = z.object({
  meta: BenchRunMetaSchema,
  scenarios: z.array(
    z.object({
      id: z.string(),
      api_route: z.enum(["chat_completions", "messages"]),
      runs: z.array(
        z.object({
          ttft_ms: z.number().nullable(),
          tpot_ms: z.number().nullable(),
          total_ms: z.number(),
          output_text: z.string(),
          stream_completed: z.boolean(),
          quality: z
            .object({
              pass: z.boolean(),
              score: z.number().optional(),
              reason: z.string().optional(),
            })
            .optional(),
        }),
      ),
    }),
  ),
  events_sample: z.array(StreamEventSchema).optional(),
});
export type BenchResult = z.infer<typeof BenchResultSchema>;
