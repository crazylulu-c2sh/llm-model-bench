import { z } from "zod";
import { ProviderKindSchema } from "./provider-kind";
// 아래 요청 바디 스키마에서 로컬로 사용(재-export만으론 로컬 바인딩이 안 생김).
import { STRESS_WORKLOAD_IDS as STRESS_WORKLOAD_IDS_LOCAL, type StressWorkloadId as StressWorkloadIdLocal } from "./scenarios-preview";
import { StressRampConfigSchema as StressRampConfigSchemaLocal } from "./stress";

export {
  ALL_SCENARIO_IDS,
  BENCH_PUBLIC_EXECUTION_ORDER_IDS,
  DEFAULT_SCENARIO_IDS,
  PUBLIC_SCENARIO_IDS,
  STRESS_WORKLOAD_IDS,
  VISION_SCENARIO_IDS,
  defaultMaxTokensForVisionScenario,
  defaultMaxTokensForWorkload,
  expectedScriptForWorkload,
  getScenarioImageAssets,
  getScenarioSystemPromptPreview,
  getScenarioUserPromptPreview,
  isScenarioId,
  isStressWorkloadId,
  isVisionScenario,
  normalizeScenarioIdsForBench,
  rubricToScore,
  scenarioCategory,
  scenarioExecutionOrderIndex,
  scoreToRubric,
  visionImageFilename,
  type ScenarioCategory,
  type ScenarioId,
  type ScenarioImageAsset,
  type ScenarioPromptPreviewOpts,
  type StressWorkloadId,
} from "./scenarios-preview";

export { getScenarioBenchMeta, type ScenarioBenchMeta } from "./scenario-meta";

export {
  CHART_VALUE_ABS_TOL,
  COUNT_RED_CARS_MAX_PLAUSIBLE,
  COUNT_RED_CARS_TOL_FAR,
  COUNT_RED_CARS_TOL_NEAR,
  DEFAULT_CALENDAR_TIMEZONE,
  DEFAULT_LLM_JUDGE_MODEL,
  JUDGE_FAILURE_LABELS,
  LLM_JUDGE_MAX_RETRIES,
  LLM_JUDGE_TIMEOUT_MS,
  MEME_PREFILTER_CUES,
  OCR_VALUE_REL_TOL,
  OCR_YOY_ABS_TOL,
  VISION_SCORING_GROUND_TRUTH,
  WIREFRAME_MIN_SEMANTIC_TAGS,
  WIREFRAME_SEMANTIC_TAGS,
  cueAlternationSource,
  type VisionScoringGroundTruthId,
} from "./scenario-scoring-constants";

export { visionSubcategoryLabel } from "./vision-category";

export {
  anthropicToolsForScenario,
  openAiToolsForScenario,
  TRANSLATE_TOOLS_ANTHROPIC,
  TRANSLATE_TOOLS_OPENAI,
} from "./scenario-tools";

// #79/#83: 런타임 시나리오 레지스트리(선언형 agent_loop·커스텀 시나리오).
export {
  RuntimeToolSchema,
  JudgeRubricSchema,
  ScenarioSamplingSchema,
  MockToolSchema,
  CompletionPredicateSchema,
  AgentLoopSchema,
  ScenarioDefSchema,
  CustomScenarioInputSchema,
  RESERVED_ID_PREFIXES,
  runtimeToolsToOpenAi,
  runtimeToolsToAnthropic,
  registerScenarioDef,
  unregisterScenarioDef,
  getScenarioDef,
  isRegisteredScenario,
  listScenarioDefs,
  clearRegisteredScenarios,
  type RuntimeTool,
  type JudgeRubric,
  type ScenarioSampling,
  type MockTool,
  type CompletionPredicate,
  type AgentLoop,
  type ScenarioDef,
  type CustomScenarioInput,
} from "./scenario-registry";
// side-effect: built-in agent_loop 정의를 레지스트리에 등록(재-export가 모듈 로드를 강제).
export { AGENT_LOOP_MOCK_V1, BUILTIN_AGENT_LOOP_IDS } from "./agent-loop-builtin";

export {
  chooseImageDelivery,
  isLoopbackOrPrivateOrigin,
  type ImageDelivery,
} from "./vision-origin";

export {
  getScenarioBenchRequestPreview,
  type ScenarioBenchRequestPreview,
  type ScenarioRequestPreviewOpts,
} from "./scenario-request-preview";

export {
  approxOutputTokens,
  effectiveOutputTokens,
  outputTokensFromRun,
  tokensPerSecondFromRun,
  tpsSourceFromUsage,
} from "./tps";

export { formatTtftMs, formatTps } from "./metrics-display";

export {
  resolveBenchApiRoutes,
  type BenchApiRoute,
  type DetectCapabilities,
} from "./bench-api-routes";

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
  GpuDeviceSnapshotSchema,
  GpuSnapshotSchema,
  LmsAvailabilitySchema,
  LoadedModelInfoSchema,
  MonitorSnapshotResponseSchema,
  ProviderMonitorSourceSchema,
  SystemSnapshotSchema,
  type GpuDeviceSnapshot,
  type GpuSnapshot,
  type LmsAvailability,
  type LoadedModelInfo,
  type MonitorSnapshotResponse,
  type ProviderMonitorSource,
  type SystemSnapshot,
} from "./monitor";

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

export { ProviderKindSchema, type ProviderKind } from "./provider-kind";

export {
  inferModelVendor,
  cleanModelDisplayName,
  parseModelQuant,
  type VendorKey,
} from "./model-vendor";

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

/**
 * #81: 메모리-핏 프리플라이트 정책. 후보 로드 전 필요 RAM vs 여유 RAM을 예측해:
 * - `skip`: 안 맞으면 로드하지 않고 사람이 읽을 수 있는 이유로 런을 기록(raw 400 대신).
 * - `unload_other_models`: 다른 로드된 인스턴스를 언로드해 자리를 만든 뒤 로드.
 * 미지정(undefined)이면 예측을 로그만 하고 그대로 진행(하위호환 — 아무것도 자동 언로드하지 않음).
 */
export const FitPolicySchema = z.enum(["skip", "unload_other_models"]).optional();
export type FitPolicy = z.infer<typeof FitPolicySchema>;

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
  /** Stop strings sent as OpenAI `stop` (family-specific, e.g. Qwen `<|im_end|>`) */
  stop: z.array(z.string()).optional(),
  /** OpenAI-compatible servers: merged into request JSON */
  extra_body: z.record(z.string(), z.unknown()).optional(),
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
  /** 오염 가드: 해석·클램프된 config (INSERT 시점 기록; `effective`는 사전 probe 후 결정되어 meta엔 없음 → contention_summary로). */
  contention_guard_enabled: z.boolean().optional(),
  contention_poll_interval_ms: z.number().optional(),
  contention_max_retries_per_iteration: z.number().optional(),
  contention_pre_bench_timeout_ms: z.number().optional(),
  contention_between_iteration_timeout_ms: z.number().optional(),
  contention_total_wait_budget_ms: z.number().optional(),
  contention_gpu_util_threshold_pct: z.number().optional(),
  contention_required_consecutive_idle: z.number().optional(),
  contention_server_metrics_enabled: z.boolean().optional(),
  contention_lms_cli_activity_enabled: z.boolean().optional(),
  /** #81: 메모리-핏 프리플라이트 정책(요청에서 전달; 미지정이면 예측만 로그 후 진행). */
  fit_policy: FitPolicySchema,
  /** #81: 프리플라이트 결과 요약(런 종료 시 meta_json에 머지 — /runs/:id·scoreboard에서 노출). */
  preflight_memory_fit: z
    .object({
      model_id: z.string(),
      required_bytes: z.number().nullable(),
      free_bytes: z.number(),
      resident_ram_bytes: z.number(),
      will_fit: z.boolean(),
      action: z.enum(["proceed", "unload_other_models", "skip"]),
      reason: z.string(),
      size_source: z.enum(["list", "detect", "unknown"]),
    })
    .optional(),
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
    /** 벤치 종료 후 자동 언로드(`after_bench`) 또는 #81 메모리-핏 자리 만들기(`preflight_fit`). */
    phase: z.enum(["after_bench", "preflight_fit"]).optional(),
    ok: z.boolean(),
    status: z.number().optional(),
  }),
  /** #81: 후보 로드 전 메모리-핏 예측 결과(항상 emit — 정책 미지정이어도 로그). */
  z.object({
    type: z.literal("preflight_memory_fit"),
    model_id: z.string(),
    /** 후보 필요 RAM 추정(오버헤드 포함 전 raw size_bytes). 미상이면 null. */
    required_bytes: z.number().nullable(),
    free_bytes: z.number(),
    resident_ram_bytes: z.number(),
    will_fit: z.boolean(),
    action: z.enum(["proceed", "unload_other_models", "skip"]),
    reason: z.string(),
    size_source: z.enum(["list", "detect", "unknown"]),
  }),
  z.object({
    type: z.literal("scenario_start"),
    scenario_id: z.string(),
    api_route: z.enum(["chat_completions", "messages"]),
    /** 실제 system 메시지 — 라이브 UI 상세와 요청 정합용 */
    system_prompt: z.string().optional(),
    /** 실제 user 메시지 — 라이브 UI 상세와 요청 정합용 */
    user_prompt: z.string().optional(),
    /** 비전 시나리오에서만 채워짐 — D4 재현성용 안정 경로. base64 데이터 URL은 절대 포함하지 않는다. */
    image_refs: z.array(z.string()).optional(),
    /** 비전 시나리오에서만 채워짐 — D1 분기 결과(`base64`/`url`). */
    image_delivery: z.enum(["base64", "url"]).optional(),
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
      total_ms: z.number(),
      output_chars: z.number(),
      approx_tokens: z.number().optional(),
      /** provider 보고 출력 토큰 수(없으면 null). 있으면 TPS가 이 값을 사용. */
      usage_output_tokens: z.number().nullable().optional(),
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
    aggregate: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal("run_finished"), run_id: z.string() }),
  z.object({
    type: z.literal("error"),
    layer: z.enum(["upstream", "downstream", "orchestrator"]),
    code: z.string(),
    message: z.string(),
    partial: z.record(z.string(), z.unknown()).optional(),
  }),
  /** 오염 가드: 다른 추론이 실행 중이라 사전/이터레이션 간 대기 중. */
  z.object({
    type: z.literal("contention_waiting"),
    phase: z.enum(["pre_bench", "between_iterations"]),
    waiting_reason: z.string(),
    reasons: z.array(z.string()),
    gpu_util_pct: z.number().nullable().optional(),
    gpu_signal_available: z.boolean(),
    elapsed_ms: z.number(),
    scenario_id: z.string().optional(),
    api_route: z.enum(["chat_completions", "messages"]).optional(),
  }),
  /** 오염 가드: 대기 후 유휴 확인되어 진행 재개. */
  z.object({
    type: z.literal("contention_resumed"),
    phase: z.enum(["pre_bench", "between_iterations"]),
    waited_ms: z.number(),
    scenario_id: z.string().optional(),
    api_route: z.enum(["chat_completions", "messages"]).optional(),
  }),
  /** 오염 가드: 측정 런이 경합으로 오염되어 폐기(재측정 여부 포함). */
  z.object({
    type: z.literal("iteration_discarded"),
    scenario_id: z.string(),
    api_route: z.enum(["chat_completions", "messages"]),
    /** 측정 phase 인덱스 = i - warmup_runs */
    measured_index: z.number(),
    retry_count: z.number(),
    max_retries: z.number(),
    will_retry: z.boolean(),
    reason: z.string(),
    reasons: z.array(z.string()),
  }),
  /** 오염 가드: 런 종료 시(또는 사전 중단 시) 단일 요약. */
  z.object({
    type: z.literal("contention_summary"),
    total_iterations_discarded: z.number(),
    max_pre_bench_wait_ms: z.number(),
    max_between_iteration_wait_ms: z.number(),
    total_wait_ms: z.number(),
    guard_effective: z.boolean(),
    gpu_signal_available: z.boolean(),
    abort_reason: z.string().optional(),
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
          total_ms: z.number(),
          output_text: z.string(),
          stream_completed: z.boolean(),
          /** provider 보고 출력 토큰 수(없으면 null/미존재). 있으면 TPS가 이 값을 사용. */
          usage_output_tokens: z.number().nullable().optional(),
          /** messages 라우트에서 추론이 숨겨진 채 측정됨 → TTFT 비교 주의(서버 계산). */
          reasoning_hidden: z.boolean().optional(),
          /** #1922: 스트리밍 tool_call 인자 연결 손상 감지 → LM Studio 엔진 프로토콜 회귀 의심(서버 계산). */
          tool_call_args_corrupted: z.boolean().optional(),
          /** chat 라우트에서 추론이 content로 새어 들어옴 → 엔진 프로토콜 회귀 의심(서버 계산). */
          reasoning_leaked_into_content: z.boolean().optional(),
          /** #80: 분리된 reasoning 채널의 raw 문자 수(있으면). thinking_leak_ratio 집계 분자. */
          reasoning_chars: z.number().optional(),
          /** #80: 가시 content가 비었고 tool_call도 없음 → 에이전트 정체(empty_turn) 신호(서버 계산). */
          empty_response: z.boolean().optional(),
          /** #80: 가시 content에 <think>/<|channel|> 태그가 남음 → 채널 태그 누수(라우트 무관, 서버 계산). */
          channel_tag_leak_detected: z.boolean().optional(),
          /** #79: agent_loop — content=="" && tool_calls==0 인 빈 턴 수(정체 신호). */
          empty_turn_count: z.number().int().optional(),
          /** #79: agent_loop — 완료까지 걸린 턴 수(미완료면 null). */
          turns_to_completion: z.number().int().nullable().optional(),
          /** #79: agent_loop — 유효 tool_call을 낸 턴 비율(0~1). */
          valid_tool_call_rate: z.number().optional(),
          /** #79: agent_loop — 중간(비최종) 턴 content에 사고/채널 태그가 누수됐는지. */
          intermediate_turn_leak: z.boolean().optional(),
          /** #101: agent_loop — 사고가 per-turn max_tokens를 소진해 빈 content로 끝난 턴이 있었는지(no_signal 시그니처). */
          thinking_exhausted_budget: z.boolean().optional(),
          /** #79: agent_loop — 루프 종료 사유. */
          agent_completion_reason: z.enum(["completed", "stall", "budget_exhausted"]).optional(),
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

// ─── HTTP 요청 바디 스키마 — 서버 라우트 검증 + OpenAPI 단일 소스 ──────────────
// (구 apps/server/src/index.ts에서 이전. detect는 z.custom 대신 실제 DetectResultSchema로
//  검증해 OpenAPI에 표현 가능하게 함.)

/** bench·stress 공용 LLM 프로파일 family(구 minimax_m27 별칭 흡수). */
const BenchProfileIdSchema = z.preprocess(
  (v) => (v === "minimax_m27" ? "minimax" : v),
  z
    .enum([
      "auto",
      "unknown",
      "gemma4",
      "qwen35",
      "qwen36",
      "gpt_oss",
      "minimax",
      "nemotron3",
      "qwen3_coder_next",
      "glm47_flash",
    ])
    .optional(),
);
const BenchTaskModeSchema = z.enum(["general", "coding", "tool"]).optional();
const ThinkingIntentSchema = z.enum(["on", "off"]).optional();
const PresetOverrideSchema = z
  .enum(["default", "thinking_general", "thinking_coding", "nonthinking_general", "tool_call"])
  .optional();
const ReasoningEffortSchema = z.enum(["minimal", "low", "medium", "high"]).optional();

export const DetectBodySchema = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().optional(),
  manual: z
    .object({
      provider: ProviderKindSchema,
      models: z.array(z.object({ id: z.string(), label: z.string().optional() })).optional(),
    })
    .optional(),
});
export type DetectBody = z.infer<typeof DetectBodySchema>;

export const BenchStreamBodySchema = z.object({
  detect: DetectResultSchema,
  bench: z.object({
    baseUrl: z.string(),
    apiKey: z.string().optional(),
    provider: ProviderKindSchema,
    modelId: z.string(),
    scenarioIds: z.array(z.string()).optional(),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    requestTimeoutMs: z.number().int().positive().optional(),
    warmupRuns: z.number().optional(),
    measuredRuns: z.number().optional(),
    skipModelLoad: z.boolean().optional(),
    unloadOtherModels: z.boolean().optional(),
    autoUnloadAfterBench: z.boolean().optional(),
    /** #81: 메모리-핏 프리플라이트 정책(`skip` | `unload_other_models`; 미지정이면 예측만 로그 후 진행). */
    fitPolicy: FitPolicySchema,
    publicAssetsOrigin: z.string().url().optional(),
    profileId: BenchProfileIdSchema,
    profileMaxTokens: z.number().int().positive().optional(),
    apiRoutes: z.array(z.enum(["chat_completions", "messages"])).optional(),
    taskMode: BenchTaskModeSchema,
    thinkingIntent: ThinkingIntentSchema,
    preserveThinking: z.boolean().optional(),
    presetOverride: PresetOverrideSchema,
    samplingOverrides: SamplingParamsSchema.optional(),
    reasoningEffort: ReasoningEffortSchema,
    // 오염 가드 config (해석·클램프는 서버 resolveContentionConfig가 담당).
    contentionGuardEnabled: z.boolean().optional(),
    contentionPollIntervalMs: z.number().int().positive().optional(),
    contentionMaxRetriesPerIteration: z.number().int().nonnegative().optional(),
    contentionPreBenchTimeoutMs: z.number().int().nonnegative().optional(),
    contentionBetweenIterationTimeoutMs: z.number().int().nonnegative().optional(),
    contentionTotalWaitBudgetMs: z.number().int().nonnegative().optional(),
    contentionGpuUtilThresholdPct: z.number().optional(),
    contentionRequiredConsecutiveIdle: z.number().int().positive().optional(),
    contentionServerMetricsEnabled: z.boolean().optional(),
    contentionLmsCliActivityEnabled: z.boolean().optional(),
  }),
});
export type BenchStreamBody = z.infer<typeof BenchStreamBodySchema>;

export const StressStreamBodySchema = z.object({
  detect: DetectResultSchema,
  stress: z.object({
    baseUrl: z.string(),
    apiKey: z.string().optional(),
    provider: ProviderKindSchema,
    modelId: z.string(),
    workloadId: z.enum(STRESS_WORKLOAD_IDS_LOCAL as [StressWorkloadIdLocal, ...StressWorkloadIdLocal[]]),
    ramp: StressRampConfigSchemaLocal,
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().optional(),
    workerPromptSuffix: z.boolean().optional(),
    requestTimeoutMs: z.number().int().positive().optional(),
    skipModelLoad: z.boolean().optional(),
    unloadOtherModels: z.boolean().optional(),
    autoUnloadAfterBench: z.boolean().optional(),
    profileId: BenchProfileIdSchema,
    taskMode: BenchTaskModeSchema,
    thinkingIntent: ThinkingIntentSchema,
    preserveThinking: z.boolean().optional(),
    presetOverride: PresetOverrideSchema,
    samplingOverrides: SamplingParamsSchema.optional(),
    reasoningEffort: ReasoningEffortSchema,
  }),
});
export type StressStreamBody = z.infer<typeof StressStreamBodySchema>;

// ─── 모델 정렬 비교자(순수) ─────────────────────────────────────────────────
export {
  normalizeBaseUrl,
  compareModelIdAlphanumeric,
  compareModelBenchQueueOrder,
  compareModelKey,
} from "./model-sort";

// ─── 스코어링(품질·속도·스코어보드) — web·server·mcp 단일 소스 ────────────────
export {
  computeQualityScores,
  type QualityCaveat,
  type QualityGroupScore,
  type ModelQualityScore,
  type QualityInput,
} from "./scoring/quality-score";
export {
  SPEED_REFERENCE,
  tpsSpeedRatio,
  speedScoreForRow,
  computeSpeedScores,
  type SpeedInput,
  type SpeedGroup,
  type ModelSpeedScore,
} from "./scoring/speed-score";
export {
  averageRunsToScoringRow,
  buildScoringRows,
  scoringRowsFromBenchDetails,
  computeScoreboard,
  scoreboardFromRows,
  type ScoringRunInput,
  type ScoringAggregate,
  type ScoringResultRow,
  type ScoringRow,
  type ScoreboardRow,
  type ScoringBenchDetailInput,
} from "./scoring/scoreboard";
export {
  AGENT_SAFE_THRESHOLDS,
  isAgentSafe,
  runIsEmptyTurn,
  runHasChannelTagLeak,
  leakMetricsFromBenchDetails,
  leakMetricsFromRows,
  type LeakRunInput,
  type LeakMetrics,
  type ModelRouteLeakMetrics,
  type LeakBenchDetailInput,
  type LeakResultRow,
} from "./scoring/leak-metrics";
// #84: 런/모델 회귀 diff.
export {
  ttftPercentiles,
  computeCompare,
  MetricDeltaSchema,
  RegressionKindSchema,
  CompareThresholdsSchema,
  CompareScenarioSchema,
  CompareRunRefSchema,
  CompareResponseSchema,
  type MetricDelta,
  type RegressionKind,
  type CompareThresholds,
  type CompareScenario,
  type CompareResponse,
  type CompareBenchDetailInput,
  type CompareRunInput,
} from "./scoring/compare";

// ─── 시나리오 카탈로그 + task 필터 매핑(에이전트 대상 API) ─────────────────────
export {
  ScenarioMetaSchema,
  ScenarioDescriptorSchema,
  ScenarioCatalogResponseSchema,
  buildScenarioCatalog,
  SCOREBOARD_TASKS,
  isScoreboardTask,
  scenarioIdsForTask,
  ScoreboardRowResponseSchema,
  ScoreboardResponseSchema,
  LeakMetricsRowSchema,
  type ScenarioDescriptor,
  type ScenarioCatalogResponse,
  type ScoreboardTask,
  type ScoreboardResponse,
  type LeakMetricsRow,
} from "./scenario-catalog";
