import { z } from "zod";
import type { ResolvedBenchProfile } from "./llm-profiles";
import { LoadTtlStatusSchema } from "./provider-kind";
import { STRESS_WORKLOAD_IDS } from "./scenarios-preview";

export type StressProviderKind =
  | "lm_studio"
  | "ollama"
  | "unsloth_studio"
  | "openai_compatible"
  | "manual";

export type StressApiRoute = "chat_completions" | "messages";

export type StressScriptMatch = "ko" | "ja" | "latin" | "mixed" | "unknown";

export type StressTpsSource = "usage" | "approx" | "mixed";

export type StressRunStatus = "running" | "ok" | "partial" | "error";

export interface StressRampConfig {
  /** 시작 동시성 (>= 1) */
  start: number;
  /** 최대 동시성 (>= start) */
  max: number;
  /** 동시성 증가 폭 (>= 1) */
  step: number;
  /** 단계당 새 요청 enqueue 시간(ms). 이후 drain. */
  durationMs: number;
}

export const StressRampConfigSchema = z.object({
  start: z.number().int().min(1).max(256),
  max: z.number().int().min(1).max(256),
  step: z.number().int().min(1).max(64),
  durationMs: z.number().int().min(100).max(600_000),
});

export const StressRunMetaSchema = z.object({
  run_id: z.string(), app_version: z.string().optional(), base_url: z.string(),
  provider: z.enum(["lm_studio", "ollama", "unsloth_studio", "openai_compatible", "manual"]),
  model_id: z.string(), publisher: z.string().optional(), api_route: z.enum(["chat_completions", "messages"]),
  workload_id: z.enum(STRESS_WORKLOAD_IDS), max_tokens: z.number(), temperature: z.number(),
  ramp: StressRampConfigSchema, request_timeout_ms: z.number(), worker_prompt_suffix: z.boolean(),
  profile_id: z.string().optional(), profile_preset: z.string().optional(),
  profile_task_mode: z.enum(["general", "coding", "tool"]).optional(),
  profile_thinking_intent: z.enum(["on", "off"]).optional(),
  effective_sampling: z.record(z.string(), z.number().optional()).optional(),
  extra_body: z.record(z.string(), z.unknown()).optional(),
  reasoning_effort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  unload_other_models: z.boolean().optional(), auto_unload_after_bench: z.boolean().optional(),
  skip_model_load: z.boolean().optional(), load_ttl_seconds: z.number().optional(), created_at: z.string(),
});
export type StressRunMeta = z.infer<typeof StressRunMetaSchema>;
export const StressStageLatencyMsSchema = z.object({ p50: z.number().nullable(), p95: z.number().nullable() });
export type StressStageLatencyMs = z.infer<typeof StressStageLatencyMsSchema>;
export const StressStageResultSchema = z.object({
  stage_index: z.number(), concurrency: z.number(), duration_ms: z.number(), enqueue_duration_ms: z.number(), drain_ms: z.number(),
  requests_attempted: z.number(), requests_succeeded: z.number(), output_tokens_total: z.number(),
  aggregate_tps: z.number().nullable(), tps_per_user: z.number().nullable(), tps_unreliable: z.literal(true).optional(),
  latency_ms: StressStageLatencyMsSchema, ttft_ms: StressStageLatencyMsSchema.optional(), error_rate: z.number(),
  tps_source: z.enum(["usage", "approx", "mixed"]), script_match_rate: z.number().nullable().optional(),
});
export type StressStageResult = z.infer<typeof StressStageResultSchema>;
export const StressStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run_started"), run_id: z.string(), meta: StressRunMetaSchema }),
  z.object({ type: z.literal("model_loaded"), model_id: z.string(),
    lm_studio_prepare: z.enum(["loaded", "already_in_memory", "load_skipped_by_request", "jit_load_with_ttl"]).optional(),
    unsloth_prepare: z.enum(["loaded", "already_in_memory", "load_skipped_by_request"]).optional(),
    load_ttl_status: LoadTtlStatusSchema.optional() }),
  z.object({ type: z.literal("model_unloaded"), model_id: z.string(), phase: z.literal("after_bench"), ok: z.boolean(), status: z.number().optional() }),
  z.object({ type: z.literal("stress_stage_started"), stage_index: z.number(), concurrency: z.number(), workload_id: z.enum(STRESS_WORKLOAD_IDS) }),
  z.object({ type: z.literal("stress_worker_request_start"), stage_index: z.number(), worker_index: z.number(), request_id: z.string(), user_prompt: z.string(), system_prompt: z.string().optional() }),
  z.object({ type: z.literal("stress_worker_token_delta"), stage_index: z.number(), worker_index: z.number(), request_id: z.string(), text: z.string(), reasoning: z.boolean().optional() }),
  z.object({ type: z.literal("stress_worker_request_end"), stage_index: z.number(), worker_index: z.number(), request_id: z.string(), ok: z.boolean(),
    ttft_ms: z.number().nullable(), total_ms: z.number(), output_chars: z.number(), output_tokens: z.number(), tps_source: z.enum(["usage", "approx", "mixed"]),
    stream_completed: z.boolean(), script_match: z.enum(["ko", "ja", "latin", "mixed", "unknown"]).optional(), error_code: z.string().optional(), error_message: z.string().optional() }),
  z.object({ type: z.literal("stress_stage_tick"), stage_index: z.number(), concurrency: z.number(), aggregate_tps_so_far: z.number().nullable(), succeeded_so_far: z.number() }),
  z.object({ type: z.literal("stress_stage_finished"), stage_index: z.number(), result: StressStageResultSchema }),
  z.object({ type: z.literal("run_finished"), run_id: z.string(), stages: z.array(StressStageResultSchema) }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string(), partial: z.object({ stage_index: z.number().optional(), worker_index: z.number().optional() }).optional() }),
]);
export type StressStreamEvent = z.infer<typeof StressStreamEventSchema>;

export interface StressResult {
  meta: StressRunMeta;
  stages: StressStageResult[];
}

/** UI 라이브 그리드 셀 수 상한(나머지 워커는 집계 only). */
export const STRESS_MAX_LIVE_CELLS = 16;

/** 모델 벤치와 동일 ResolvedBenchProfile 재사용 — 타입 export 편의. */
export type StressResolvedProfile = ResolvedBenchProfile;

export type StressRunListItem = {
  run_id: string;
  created_at: string;
  finished_at: string | null;
  base_url: string;
  provider: string;
  model_id: string;
  /** 모델 게시자(조직) — meta_json에 없으면(기존 런) model_id 접두 파생. */
  publisher?: string;
  workload_id: string;
  status: StressRunStatus;
};

export type StressRunFilterOptions = {
  workload_ids: string[];
  statuses: StressRunStatus[];
  model_ids: string[];
  base_urls: string[];
};

export type StressRunsListResponse = {
  items: StressRunListItem[];
  filter_options: StressRunFilterOptions;
  has_more: boolean;
  sqlite_available: boolean;
  sqlite_error?: string;
};

export type StressRunDetailResponse = {
  meta: StressRunMeta & {
    status: StressRunStatus;
    finished_at: string | null;
    error_code: string | null;
    error_message: string | null;
  };
  stages: StressStageResult[];
};
