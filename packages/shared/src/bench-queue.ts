import { z } from "zod";
import { ProviderKindSchema } from "./provider-kind";
import {
  inferLlmProfileFamily,
  type BenchTaskMode,
  type LlmProfileFamily,
  type ReasoningEffort,
  type SamplingParams,
  type SamplingPresetName,
  type ThinkingIntent,
} from "./llm-profiles";

/**
 * 서버가 소유하는 모델 큐(여러 모델 순차 실행)의 와이어 타입과, 큐가 모델마다 다시 계산해야
 * 하는 프로파일 게이트.
 *
 * 큐가 서버로 온 이유: 클라이언트가 큐를 몰면 새로고침한 탭이 죽는 순간 남은 모델이 영영
 * 실행되지 않고, 탭 두 개가 각자 이어받으면 같은 GPU에 벤치가 겹쳐 조용한 측정 오염이 된다.
 * (AGENTS.md의 serial model execution 요구사항)
 *
 * `StreamEvent`를 참조하지 않는 것만 여기 둔다 — 큐 이벤트 유니온(`BenchQueueStreamEventSchema`)은
 * `StreamEventSchema`의 상위집합이라 index.ts에서 조립한다(순환 임포트 방지).
 */

// ---------------------------------------------------------------- 모델별 프로파일 게이트

/** 성능 측정 모드의 고정 출력 한도(토큰) — 처리량 비교 재현성을 위해 모든 모델 동일. */
export const BENCH_THROUGHPUT_MAX_TOKENS = 512;

/**
 * 큐 전체가 공유하는 "의도". 모델마다 값이 달라지는 것은 reasoning effort 두 칸뿐이며,
 * 나머지는 전역 폼 상태라 그대로 공유해도 안전하다.
 */
export type BenchProfileIntent = {
  profileId?: LlmProfileFamily | "auto";
  taskMode?: BenchTaskMode;
  thinkingIntent?: ThinkingIntent;
  preserveThinking?: boolean;
  presetOverride?: SamplingPresetName | null;
  samplingOverrides?: Partial<SamplingParams> | null;
  /** gpt-oss 계열용(minimal|low|medium|high). */
  reasoningEffort?: ReasoningEffort | null;
  /**
   * Qwen3.8 계열용(xhigh|medium|low). gpt-oss와 유효 범위가 달라 칸을 나눈다 — 하나로 합치면
   * profileId="auto" + 혼합 모델 큐에서 한쪽 선택이 반드시 유실된다(클램프되어 조용히 다른 값으로 측정).
   */
  qwen38ReasoningEffort?: ReasoningEffort | null;
  profileMaxTokens?: number | null;
  /** 성능 측정 모드: 사고 off + 고정 출력 한도. */
  benchmarkThroughputMode?: boolean;
};

/** `BenchRequest.profile`에 그대로 들어가는, 모델 1건으로 해석된 프로파일. */
export type ResolvedBenchProfilePayload = {
  profileId?: LlmProfileFamily | "auto";
  taskMode?: BenchTaskMode;
  profileMaxTokens?: number;
  thinkingIntent?: ThinkingIntent;
  preserveThinking: boolean;
  reasoningEffort?: ReasoningEffort;
  presetOverride?: SamplingPresetName;
  samplingOverrides?: Partial<SamplingParams>;
};

/**
 * 의도 + modelId → 그 모델에 실제로 보낼 프로파일. 웹의 `buildBenchProfilePayload`와
 * **글자 그대로 같은 규칙**이어야 한다 — 큐를 서버가 돌리면서 규칙이 갈라지면 같은 큐 안에서
 * 모델마다 다른 해석이 적용된다.
 */
export function benchProfileForModel(
  modelId: string,
  intent: BenchProfileIntent,
): ResolvedBenchProfilePayload {
  const profileId = intent.profileId;
  const fam: LlmProfileFamily =
    profileId == null || profileId === "auto" ? inferLlmProfileFamily(modelId) : profileId;
  const throughput = !!intent.benchmarkThroughputMode;
  const maxTok = intent.profileMaxTokens;
  const profileMaxTokensNum =
    maxTok != null && Number.isFinite(maxTok) && maxTok > 0 ? Math.floor(maxTok) : undefined;
  return {
    profileId,
    taskMode: intent.taskMode,
    profileMaxTokens: throughput ? BENCH_THROUGHPUT_MAX_TOKENS : profileMaxTokensNum,
    thinkingIntent: throughput ? "off" : intent.thinkingIntent,
    preserveThinking:
      (fam === "qwen36" || fam === "qwen38") && !throughput ? !!intent.preserveThinking : false,
    reasoningEffort:
      fam === "gpt_oss"
        ? (intent.reasoningEffort ?? undefined)
        : fam === "qwen38"
          ? (intent.qwen38ReasoningEffort ?? undefined)
          : undefined,
    presetOverride: throughput ? undefined : (intent.presetOverride ?? undefined),
    samplingOverrides: intent.samplingOverrides ?? undefined,
  };
}

// ---------------------------------------------------------------- 모델 실행 결과 분류

/**
 * 큐의 모델 1건 상태. 웹 `QueueModelStatus`와 리터럴이 같아야 한다(매핑 테이블을 두지 않기 위해).
 * UI 파생 상태인 "paused"는 서버가 모델 상태로 내보내지 않으므로 여기 없다.
 */
export const BenchQueueModelStatusSchema = z.enum([
  "pending",
  "running",
  "done",
  "done-with-errors",
  "failed",
  "cancelled",
]);
export type BenchQueueModelStatus = z.infer<typeof BenchQueueModelStatusSchema>;

/** 모델 1건 실행의 관측치. 런 전체 누적값과 별개로 모델별로 모아야 한다. */
export type ModelRunOutcome = {
  /** 클라이언트 개념(HTTP 응답이 non-2xx). 서버 큐에서는 항상 false다 — 스트림을 직접 소비한다. */
  httpFailed: boolean;
  threw: boolean;
  /** `run_finished` 이벤트를 받았는지 */
  sawRunFinished: boolean;
  /** `run_finished`의 사유가 취소였거나, 긴급 정지로 건너뛴 모델 */
  cancelled: boolean;
  skippedByPreflight: boolean;
  scenarioErrorCount: number;
};

/**
 * 취소를 가장 먼저 본다 — 긴급 정지도 `run_finished`를 내보내므로 순서를 바꾸면 중지된 모델이 "완료"로 찍힌다.
 * 시나리오 일부만 실패한 경우는 나머지 결과가 유효하므로 실패가 아니라 부분 오류로 분류한다.
 */
export function classifyModelOutcome(outcome: ModelRunOutcome): BenchQueueModelStatus {
  if (outcome.cancelled) return "cancelled";
  if (outcome.skippedByPreflight) return "failed";
  if (outcome.httpFailed || outcome.threw || !outcome.sawRunFinished) return "failed";
  return outcome.scenarioErrorCount > 0 ? "done-with-errors" : "done";
}

// ---------------------------------------------------------------- 큐 스냅샷

/** 이 큐가 모델마다 실행할 계획. `run_started.meta`에서 파생되며 이미 실행 순서다. */
export const BenchQueuePlanSchema = z.object({
  scenario_ids: z.array(z.string()),
  api_routes: z.array(z.enum(["chat_completions", "messages"])),
  warmup_runs: z.number(),
  measured_runs: z.number(),
});
export type BenchQueuePlan = z.infer<typeof BenchQueuePlanSchema>;

export const BenchQueueModelSchema = z.object({
  model_id: z.string(),
  status: BenchQueueModelStatusSchema,
  /**
   * DB 복원 키. `run_started` 이전에 실패한 모델은 `bench_runs` 행 자체가 없어 null이므로,
   * 큐 스냅샷이 그 모델의 결과를 자체 보관하는 유일한 곳이 된다.
   */
  run_id: z.string().nullable(),
  started_at: z.number().nullable(),
  finished_at: z.number().nullable(),
  error_count: z.number().int().nonnegative(),
});
export type BenchQueueModel = z.infer<typeof BenchQueueModelSchema>;

export const BenchQueueSnapshotSchema = z.object({
  queue_id: z.string(),
  base_url: z.string(),
  provider: ProviderKindSchema,
  /**
   * 레지스트리 자체 상태. DB의 `bench_runs.status`를 완료 신호로 쓰면 안 된다 —
   * 시나리오 에러 하나로 `running`→`partial`이 되면서 `finished_at`은 NULL로 남는다.
   */
  status: z.enum(["running", "finished", "cancelled"]),
  created_at: z.number(),
  finished_at: z.number().nullable(),
  /** 현재 실행 중인 모델의 인덱스. 끝났으면 models.length. */
  index: z.number().int().nonnegative(),
  paused: z.boolean(),
  /** running일 때만 채운다 — 완료 큐가 죽은 run_id를 들고 있으면 클라이언트가 그걸로 재연결해 404를 맞는다. */
  current_run_id: z.string().nullable(),
  models: z.array(BenchQueueModelSchema),
  plan: BenchQueuePlanSchema,
});
export type BenchQueueSnapshot = z.infer<typeof BenchQueueSnapshotSchema>;
