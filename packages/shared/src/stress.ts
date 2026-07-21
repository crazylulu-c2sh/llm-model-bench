import { z } from "zod";
import type { ResolvedBenchProfile } from "./llm-profiles";
import type { StressWorkloadId } from "./scenarios-preview";

export type StressProviderKind = "lm_studio" | "ollama" | "openai_compatible" | "manual";

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

export interface StressRunMeta {
  run_id: string;
  app_version?: string;
  base_url: string;
  provider: StressProviderKind;
  model_id: string;
  api_route: StressApiRoute;
  workload_id: StressWorkloadId;
  max_tokens: number;
  temperature: number;
  ramp: StressRampConfig;
  request_timeout_ms: number;
  worker_prompt_suffix: boolean;
  /** 모델 벤치와 동일 profile payload 재사용 여부(detect/profile 해석 결과). */
  profile_id?: string;
  profile_preset?: string;
  profile_task_mode?: "general" | "coding" | "tool";
  profile_thinking_intent?: "on" | "off";
  effective_sampling?: Record<string, number | undefined>;
  extra_body?: Record<string, unknown>;
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
  /** LM Studio 플래그 — bench-runner와 동일 의미 */
  unload_other_models?: boolean;
  auto_unload_after_bench?: boolean;
  skip_model_load?: boolean;
  /** 로드 시 적용한 TTL(초). LM Studio는 load `ttl`, Ollama는 `keep_alive`. */
  load_ttl_seconds?: number;
  created_at: string;
}

export interface StressStageLatencyMs {
  p50: number | null;
  p95: number | null;
}

export interface StressStageResult {
  stage_index: number;
  concurrency: number;
  duration_ms: number;
  enqueue_duration_ms: number;
  drain_ms: number;
  requests_attempted: number;
  requests_succeeded: number;
  output_tokens_total: number;
  aggregate_tps: number | null;
  tps_per_user: number | null;
  tps_unreliable?: true;
  latency_ms: StressStageLatencyMs;
  /** TTFT(첫 토큰 도착) 집계 — long-context/prefill 워크로드의 1순위 지표. v1.1+에서 추가, 구 row에는 없을 수 있음. */
  ttft_ms?: StressStageLatencyMs;
  error_rate: number;
  tps_source: StressTpsSource;
  /** 워크로드별 *예상* 스크립트 일치 비율(0–1). v1에서는 KO/JA 워크로드만 계산. */
  script_match_rate?: number | null;
}

export type StressStreamEvent =
  | { type: "run_started"; run_id: string; meta: StressRunMeta }
  | { type: "model_loaded"; model_id: string; lm_studio_prepare?: "loaded" | "already_in_memory" | "load_skipped_by_request" }
  | { type: "model_unloaded"; model_id: string; phase: "after_bench"; ok: boolean; status?: number }
  | {
      type: "stress_stage_started";
      stage_index: number;
      concurrency: number;
      workload_id: StressWorkloadId;
    }
  | {
      type: "stress_worker_request_start";
      stage_index: number;
      worker_index: number;
      request_id: string;
      user_prompt: string;
      system_prompt?: string;
    }
  | {
      type: "stress_worker_token_delta";
      stage_index: number;
      worker_index: number;
      request_id: string;
      text: string;
      /** reasoning/thinking 채널 (MiniMax reasoning_split 등) — UI는 별도 표시 */
      reasoning?: boolean;
    }
  | {
      type: "stress_worker_request_end";
      stage_index: number;
      worker_index: number;
      request_id: string;
      ok: boolean;
      ttft_ms: number | null;
      total_ms: number;
      output_chars: number;
      output_tokens: number;
      tps_source: "usage" | "approx";
      stream_completed: boolean;
      script_match?: StressScriptMatch;
      error_code?: string;
      error_message?: string;
    }
  | {
      type: "stress_stage_tick";
      stage_index: number;
      concurrency: number;
      aggregate_tps_so_far: number | null;
      succeeded_so_far: number;
    }
  | {
      type: "stress_stage_finished";
      stage_index: number;
      result: StressStageResult;
    }
  | { type: "run_finished"; run_id: string; stages: StressStageResult[] }
  | {
      type: "error";
      code: string;
      message: string;
      partial?: { stage_index?: number; worker_index?: number };
    };

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
