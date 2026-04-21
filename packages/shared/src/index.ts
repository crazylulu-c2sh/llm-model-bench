import { z } from "zod";

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
    }),
  ),
  steps: z.array(DetectStepSchema),
  capabilities: z.object({
    openaiChat: z.boolean(),
    anthropicMessages: z.boolean(),
  }),
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
  seed: z.number().nullable().optional(),
  parallel: z.boolean(),
  warmup_runs: z.number(),
  measured_runs: z.number(),
  /** LM Studio: 벤치 대상 외 감지 모델에 unload 시도 여부 */
  unload_other_models: z.boolean().optional(),
  created_at: z.string(),
});
export type BenchRunMeta = z.infer<typeof BenchRunMetaSchema>;

export const StreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run_started"), run_id: z.string() }),
  z.object({
    type: z.literal("model_loaded"),
    model_id: z.string(),
    provider: ProviderKindSchema,
  }),
  z.object({
    type: z.literal("scenario_start"),
    scenario_id: z.string(),
    api_route: z.enum(["chat_completions", "messages"]),
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
