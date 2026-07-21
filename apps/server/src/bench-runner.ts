import type {
  BenchRunMeta,
  BenchTaskMode,
  DetectResult,
  FitPolicy,
  StreamEvent,
  SystemSnapshot,
  ThinkingIntent,
} from "@llm-bench/shared";
import {
  DEFAULT_CALENDAR_TIMEZONE,
  DEFAULT_SCENARIO_IDS,
  PUBLIC_SCENARIO_IDS,
  approxOutputTokens,
  defaultMaxTokensForVisionScenario,
  getScenarioDef,
  isRegisteredScenario,
  isVisionScenario,
  normalizeScenarioIdsForBench,
  resolveBenchApiRoutes,
  rubricToScore,
  stripThinkingBlocks,
} from "@llm-bench/shared";
import { isJudgeEnabled, runLlmJudge } from "./judge.js";
import {
  type Clock,
  type ContentionConfig,
  type ContentionProbe,
  type InFlightBaseline,
  defaultSleep,
  makeContentionProbe,
  resolveContentionConfig,
  runIdleGate,
  startInflightMonitor,
} from "./contention-probe.js";
import {
  isLoopbackOrPrivateOrigin,
  loadVisionImageBytes,
  visionImageRefs,
} from "./vision-assets.js";
import { consumeAnthropicMessagesStream } from "./anthropic-stream.js";
import {
  consumeOpenAiChatStream,
  openAiBenchOutputText,
  openAiLiveTokenStreamText,
  type OpenAiStreamMetrics,
} from "./openai-stream.js";
import { openAiChatPostWithUsage } from "./openai-fetch.js";
import {
  ALL_SCENARIO_IDS,
  anthropicMessagesForScenario,
  anthropicToolsForScenario,
  buildMessages,
  isTranslateNistFips197PdfToolsScenario,
  scenarioSystemMessageContent,
  scenarioUserMessageContent,
  scoreScenario,
  type ScenarioId,
} from "./scenarios.js";
import {
  lmStudioIsModelLoaded,
  lmStudioLoad,
  lmStudioUnload,
} from "./lmstudio.js";
import { preflightMemoryFit } from "./memory-preflight.js";
import {
  runAgentLoopAnthropic,
  runAgentLoopOpenAi,
  type AgentLoopMetrics,
} from "./agent-loop.js";
import {
  anthropicExtrasFromMeta,
  buildProfileAugmentedMeta,
  openAiExtrasFromMeta,
  type BenchProfileRequestFields,
} from "./profile.js";
import {
  executeBenchTool,
  resolvePublicAssetsOrigin,
} from "./tooling/bench-tools.js";

export type BenchRequest = {
  baseUrl: string;
  apiKey?: string;
  provider: DetectResult["provider"];
  modelId: string;
  scenarioIds?: ScenarioId[];
  /** default true */
  serial?: boolean;
  temperature?: number;
  max_tokens?: number;
  warmupRuns?: number;
  measuredRuns?: number;
  /** per-request timeout (ms). default: 15m */
  requestTimeoutMs?: number;
  /** skip LM load/unload */
  skipModelLoad?: boolean;
  /** LM Studio: detect 목록에서 벤치 대상 외 모델 unload (베스트 에포트) */
  unloadOtherModels?: boolean;
  /** LM Studio: 이번 런이 lmStudioLoad로 대상을 올린 경우에만 종료 시 unload (베스트 에포트) */
  autoUnloadAfterBench?: boolean;
  /** #81: 메모리-핏 프리플라이트 정책(`skip` | `unload_other_models`; 미지정이면 예측만 로그 후 진행). */
  fitPolicy?: FitPolicy;
  /** Vite `public/` 베이스 URL (예: window.location.origin) — nist.fips.197.pdf 툴 fetch 허용 */
  publicAssetsOrigin?: string;
  /** 모델 카드 기반 샘플링/사고 모드 프로파일 */
  profile?: BenchProfileRequestFields;
  /** 프로파일 전용 max_tokens (UI). 일반 `max_tokens`와 분리해 시나리오별 권장값과 충돌하지 않게 함 */
  profileMaxTokens?: number;
  /**
   * 측정 라우트 제한(예: 성능 측정 모드 = `["chat_completions"]`). 지정 시 감지된 라우트와 교집합만 실행.
   * 교집합이 비면 무시(감지 라우트 그대로). 미지정이면 감지된 모든 라우트.
   */
  apiRoutes?: ("chat_completions" | "messages")[];
  /** 오염 가드(다른 추론 감지 시 대기/폐기·재측정). 미지정 시 기본 ON(단 manual은 비활성). */
  contentionGuardEnabled?: boolean;
  contentionPollIntervalMs?: number;
  contentionMaxRetriesPerIteration?: number;
  contentionPreBenchTimeoutMs?: number;
  contentionBetweenIterationTimeoutMs?: number;
  contentionTotalWaitBudgetMs?: number;
  contentionGpuUtilThresholdPct?: number;
  contentionRequiredConsecutiveIdle?: number;
  contentionServerMetricsEnabled?: boolean;
  contentionLmsCliActivityEnabled?: boolean;
};

const MAX_BENCH_TOOL_ROUNDS = 8;
const DEFAULT_REQUEST_TIMEOUT_MS = 900_000;
const MIN_REQUEST_TIMEOUT_MS = 60_000;
const MAX_REQUEST_TIMEOUT_MS = 3_600_000;

function clampRequestTimeoutMs(ms?: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_REQUEST_TIMEOUT_MS;
  const n = Math.floor(ms as number);
  if (n < MIN_REQUEST_TIMEOUT_MS) return MIN_REQUEST_TIMEOUT_MS;
  if (n > MAX_REQUEST_TIMEOUT_MS) return MAX_REQUEST_TIMEOUT_MS;
  return n;
}

function isAbortLikeError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: string; code?: string | number };
  return err.name === "AbortError" || err.code === 20;
}

function headers(apiKey?: string, extra?: Record<string, string>): HeadersInit {
  const h: Record<string, string> = {
    "content-type": "application/json",
    ...extra,
  };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

function runId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export { normalizeScenarioIdsForBench };

/** DB/SSE와 동일한 메타 스냅샷(런 ID만 외부에서 주입). */
export function makeBenchRunMeta(
  input: BenchRequest,
  detect: DetectResult,
  rid: string,
  opts?: { profileMaxTokensOverride?: number | null },
): BenchRunMeta {
  const base = detect.baseUrl.replace(/\/+$/, "");
  // 모델 벤치 기본값: 클라이언트가 `scenarioIds`를 안 보내면 텍스트 8개(=DEFAULT_SCENARIO_IDS)만
  // 실행한다 — 비전 시나리오는 opt-in. (이전 폴백 = PUBLIC_SCENARIO_IDS는 비전 포함 18개라 비용 폭증.)
  const userScenarioIds = input.scenarioIds?.length
    ? input.scenarioIds.filter(
        // #79/#83: built-in 공개 시나리오 또는 레지스트리(agent_loop·커스텀) 시나리오 허용.
        (s): s is ScenarioId =>
          ((PUBLIC_SCENARIO_IDS as readonly string[]).includes(s) &&
            (ALL_SCENARIO_IDS as readonly string[]).includes(s)) ||
          isRegisteredScenario(s),
      )
    : null;
  const rawScenarioIds: ScenarioId[] =
    userScenarioIds && userScenarioIds.length > 0
      ? userScenarioIds
      : (DEFAULT_SCENARIO_IDS as ScenarioId[]);
  const scenarioIds = normalizeScenarioIdsForBench(rawScenarioIds);
  const routes = resolveBenchApiRoutes(
    detect.capabilities,
    input.apiRoutes?.length ? input.apiRoutes : undefined,
  );
  const cc = resolveContentionConfig({
    provider: input.provider,
    contentionGuardEnabled: input.contentionGuardEnabled,
    contentionPollIntervalMs: input.contentionPollIntervalMs,
    contentionMaxRetriesPerIteration: input.contentionMaxRetriesPerIteration,
    contentionPreBenchTimeoutMs: input.contentionPreBenchTimeoutMs,
    contentionBetweenIterationTimeoutMs: input.contentionBetweenIterationTimeoutMs,
    contentionTotalWaitBudgetMs: input.contentionTotalWaitBudgetMs,
    contentionGpuUtilThresholdPct: input.contentionGpuUtilThresholdPct,
    contentionRequiredConsecutiveIdle: input.contentionRequiredConsecutiveIdle,
    contentionServerMetricsEnabled: input.contentionServerMetricsEnabled,
    contentionLmsCliActivityEnabled: input.contentionLmsCliActivityEnabled,
  });
  const baseMeta: BenchRunMeta = {
    run_id: rid,
    app_version: "0.0.1",
    base_url: base,
    provider: input.provider,
    model_id: input.modelId,
    api_routes: routes,
    scenario_ids: scenarioIds,
    // #105: docs/grounding corpus 를 가상 개체로 재작성 + agent 채점을 결정론으로 전환.
    // #108 후속(v8): error_v1 의 에러를 read_document 로 이동 + sources 판정 완화 + retried 실측 →
    // 이전 런과 **비교 불가**.
    // #109 후속(v9): agent_loop_chain_v1 추가 — agent 품질의 분모가 5→6 으로 바뀐다.
    scenario_bundle_version: "10",
    temperature: input.temperature ?? 0.2,
    max_tokens: input.max_tokens ?? 512,
    seed: null,
    parallel: false,
    warmup_runs: input.warmupRuns ?? 1,
    measured_runs: input.measuredRuns ?? 3,
    unload_other_models: !!input.unloadOtherModels,
    auto_unload_after_bench: !!input.autoUnloadAfterBench,
    fit_policy: input.fitPolicy,
    public_assets_origin: resolvePublicAssetsOrigin(input),
    contention_guard_enabled: cc.enabled,
    contention_poll_interval_ms: cc.pollIntervalMs,
    contention_max_retries_per_iteration: cc.maxRetriesPerIteration,
    contention_pre_bench_timeout_ms: cc.preBenchTimeoutMs,
    contention_between_iteration_timeout_ms: cc.betweenIterationTimeoutMs,
    contention_total_wait_budget_ms: cc.totalWaitBudgetMs,
    contention_gpu_util_threshold_pct: cc.gpuUtilThresholdPct,
    contention_required_consecutive_idle: cc.requiredConsecutiveIdle,
    contention_server_metrics_enabled: cc.serverMetricsEnabled,
    contention_lms_cli_activity_enabled: cc.lmsCliActivityEnabled,
    created_at: new Date().toISOString(),
  };
  if (!input.profile) return baseMeta;
  return buildProfileAugmentedMeta(baseMeta, {
    modelId: input.modelId,
    profile: input.profile,
    profileMaxTokens:
      opts?.profileMaxTokensOverride ?? input.profileMaxTokens ?? null,
  });
}

function taskModeForScenario(scenarioId: ScenarioId): BenchTaskMode {
  if (
    scenarioId === "tool_weather" ||
    isTranslateNistFips197PdfToolsScenario(scenarioId)
  )
    return "tool";
  if (scenarioId.startsWith("code_")) return "coding";
  return "general";
}

function thinkingIntentForScenario(
  scenarioId: ScenarioId,
  globalIntent: ThinkingIntent,
): ThinkingIntent {
  if (scenarioId === "structured_action") return "off";
  return globalIntent;
}

function sanitizeOpenAiAssistantContent(
  content: unknown,
  stripThinking: boolean,
): string | null | Array<Record<string, unknown>> {
  if (content == null) return null;
  if (typeof content === "string") {
    const t = stripThinking ? stripThinkingBlocks(content) : content;
    return t.trim() ? t : null;
  }
  if (Array.isArray(content)) {
    const next = content
      .map((part) => {
        if (!part || typeof part !== "object") return part;
        const p = part as { type?: string; text?: string };
        if (p.type === "text" && typeof p.text === "string") {
          const t = stripThinking ? stripThinkingBlocks(p.text) : p.text;
          return { ...p, text: t };
        }
        return part;
      })
      .filter((part) => {
        if (!part || typeof part !== "object") return true;
        const p = part as { type?: string; text?: string };
        if (p.type === "text" && typeof p.text === "string")
          return p.text.trim().length > 0;
        return true;
      });
    return next as Array<Record<string, unknown>>;
  }
  return content as Array<Record<string, unknown>>;
}

/** MiniMax Interleaved (`reasoning_split: true`) — assistant history must echo `reasoning_details`. */
function minimaxReasoningDetailsForOpenAiHistory(reasoning: string): Array<Record<string, unknown>> {
  const text = reasoning.trim();
  if (!text) return [];
  return [
    {
      type: "reasoning.text",
      id: "reasoning-text-1",
      format: "MiniMax-response-v1",
      index: 0,
      text,
    },
  ];
}

function mergeOpenAiBody(
  meta: BenchRunMeta,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const extras = openAiExtrasFromMeta(meta);
  return { ...base, ...extras };
}

/**
 * max_tokens 도달 추정. 서버가 `finish_reason: "length"`를 주면 그대로 신뢰하고, finish_reason을 아예
 * 안 주는 OpenAI 호환 서버(LM Studio/vLLM 등)에서는 출력 토큰 수가 한도에 도달했는지로 폴백한다.
 * usage(include_usage) 정확값을 우선하고, 없을 때만 근사치(approxOutputTokens ≈ len/4)를 쓴다.
 * 근사치는 stream_options 거부로 usage가 strip된 경로 등에서 과/소추정될 수 있다.
 */
function openAiLikelyTruncated(m: OpenAiStreamMetrics, maxTokens: number): boolean {
  if (m.finishReason === "length") return true;
  if (m.finishReason != null) return false; // 서버가 다른 사유를 보고 → 잘림 아님
  const tokens = m.usageOutputTokens ?? m.approxOutputTokens;
  return tokens >= maxTokens;
}

function makeScenarioBenchRunMeta(
  input: BenchRequest,
  detect: DetectResult,
  rid: string,
  scenarioId: ScenarioId,
): BenchRunMeta {
  const taskMode = taskModeForScenario(scenarioId);
  const thinkingIntent = thinkingIntentForScenario(
    scenarioId,
    input.profile?.thinkingIntent ?? "on",
  );
  const merged: BenchRequest = {
    ...input,
    profile: input.profile
      ? { ...input.profile, taskMode, thinkingIntent }
      : { taskMode, thinkingIntent },
  };
  return makeBenchRunMeta(merged, detect, rid, {
    profileMaxTokensOverride: null,
  });
}

async function canProceedAfterIterationError(
  base: string,
  input: BenchRequest,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  if (input.provider !== "lm_studio") return true;
  const loaded = await lmStudioIsModelLoaded(base, input.modelId, {
    fetchImpl,
    apiKey: input.apiKey,
  });
  return loaded.ok && loaded.loaded;
}

function applyGemmaThinkTokenToOpenAiMessages(
  messages: {
    role: string;
    content?: unknown;
    tool_calls?: unknown;
    tool_call_id?: string;
  }[],
): void {
  const sysIdx = messages.findIndex((m) => m.role === "system");
  const token = "<|think|>";
  if (sysIdx >= 0) {
    const c = messages[sysIdx].content;
    if (typeof c === "string") {
      if (!c.includes(token)) messages[sysIdx].content = `${token}${c}`;
    } else {
      messages.unshift({ role: "system", content: token });
    }
    return;
  }
  messages.unshift({ role: "system", content: token });
}

function sanitizeOpenAiMessagesForHistory(
  messages: {
    role: string;
    content?: unknown;
    tool_calls?: unknown;
    tool_call_id?: string;
  }[],
  strip: boolean,
): void {
  if (!strip) return;
  for (const m of messages) {
    if (m.role === "assistant") {
      m.content = sanitizeOpenAiAssistantContent(m.content, true);
    }
  }
}

function prepareOpenAiMessages(
  scenarioId: ScenarioId,
  promptCtx: {
    publicAssetsOrigin?: string;
    referenceAt: Date;
    calendarTimeZone: string;
  },
  scenarioMeta: BenchRunMeta,
): {
  messages: {
    role: string;
    content?: unknown;
    tool_calls?: unknown;
    tool_call_id?: string;
  }[];
  tools?: unknown;
  tool_choice?: unknown;
} {
  const built = buildMessages(scenarioId, promptCtx);
  const messages = built.messages.map((m) => ({ ...m })) as {
    role: string;
    content?: unknown;
    tool_calls?: unknown;
    tool_call_id?: string;
  }[];
  if (
    scenarioMeta.prompt_rules_applied?.gemmaThinkToken &&
    scenarioMeta.profile_thinking_intent !== "off"
  ) {
    applyGemmaThinkTokenToOpenAiMessages(messages);
  }
  return { messages, tools: built.tools, tool_choice: built.tool_choice };
}

function prepareAnthropicScenario(
  scenarioId: ScenarioId,
  promptCtx: {
    publicAssetsOrigin?: string;
    referenceAt: Date;
    calendarTimeZone: string;
  },
  scenarioMeta: BenchRunMeta,
): ReturnType<typeof anthropicMessagesForScenario> {
  const am = anthropicMessagesForScenario(scenarioId, promptCtx);
  let system = am.system;
  if (
    scenarioMeta.prompt_rules_applied?.gemmaThinkToken &&
    scenarioMeta.profile_thinking_intent !== "off"
  ) {
    const token = "<|think|>";
    system = system && system.length ? `${token}${system}` : token;
  }
  return { system, messages: am.messages.map((m) => ({ ...m })) };
}

export async function* runBench(
  input: BenchRequest,
  detect: DetectResult,
  opts: {
    fetchImpl?: typeof fetch;
    /** 테스트 전용 주입: 결정적 probe. */
    probeImpl?: ContentionProbe;
    /** 테스트 전용 주입: 가짜 시계. */
    now?: () => number;
    /** 테스트 전용 주입: 즉시 resolve sleep. */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    /** 테스트 전용 주입(#81): 가짜 시스템 스냅샷(free RAM). */
    systemInfoImpl?: () => SystemSnapshot;
  } = {},
): AsyncGenerator<StreamEvent> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = detect.baseUrl.replace(/\/+$/, "");
  // STEP 0: 오염 가드 config·probe·clock. config는 BenchRequest로 흐르고(opts는 테스트 주입 전용).
  const contentionCfg: ContentionConfig = resolveContentionConfig({
    provider: input.provider,
    contentionGuardEnabled: input.contentionGuardEnabled,
    contentionPollIntervalMs: input.contentionPollIntervalMs,
    contentionMaxRetriesPerIteration: input.contentionMaxRetriesPerIteration,
    contentionPreBenchTimeoutMs: input.contentionPreBenchTimeoutMs,
    contentionBetweenIterationTimeoutMs: input.contentionBetweenIterationTimeoutMs,
    contentionTotalWaitBudgetMs: input.contentionTotalWaitBudgetMs,
    contentionGpuUtilThresholdPct: input.contentionGpuUtilThresholdPct,
    contentionRequiredConsecutiveIdle: input.contentionRequiredConsecutiveIdle,
    contentionServerMetricsEnabled: input.contentionServerMetricsEnabled,
    contentionLmsCliActivityEnabled: input.contentionLmsCliActivityEnabled,
  });
  const clock: Clock = {
    now: opts.now ?? (() => Date.now()),
    sleep: opts.sleep ?? defaultSleep,
  };
  const contentionProbe: ContentionProbe =
    opts.probeImpl ??
    makeContentionProbe({
      provider: input.provider,
      baseUrl: base,
      apiKey: input.apiKey,
      modelId: input.modelId,
      cfg: contentionCfg,
      fetchImpl,
    });
  // 런 전역 오염 가드 상태.
  const waitAccum = { total: 0 };
  let guardEffective = false;
  let gpuSignalAvailable = false;
  let totalDiscarded = 0;
  let maxPreWait = 0;
  let maxBetweenWait = 0;
  let contentionAbortReason: string | undefined;

  const rid = runId();
  const assetOrigin = resolvePublicAssetsOrigin(input);
  const meta = makeBenchRunMeta(input, detect, rid, {
    profileMaxTokensOverride: input.profileMaxTokens ?? null,
  });
  const requestTimeoutMs = clampRequestTimeoutMs(input.requestTimeoutMs);

  yield { type: "run_started", run_id: rid, meta };

  if (!meta.api_routes.length) {
    yield {
      type: "error",
      layer: "orchestrator",
      code: "no_routes",
      message:
        "Neither /v1/chat/completions nor /v1/messages appears available for this base URL.",
    };
    return;
  }

  // STEP 0.5 (#81): 메모리-핏 프리플라이트 — 후보 로드 전 필요 RAM vs 여유 RAM 예측(항상 로그).
  // `skip`이면 raw provider 400 대신 사람이 읽을 수 있는 이유로 런을 기록하고 종료.
  // `unload_other_models`면 자리를 만들고, 아래 레거시 unloadOtherModels 루프는 건너뛴다.
  let preflightUnloadedResidents = false;
  if (input.provider === "lm_studio" && !input.skipModelLoad) {
    const fit = await preflightMemoryFit({
      base,
      modelId: input.modelId,
      apiKey: input.apiKey,
      fitPolicy: input.fitPolicy,
      detect,
      fetchImpl,
      systemInfoImpl: opts.systemInfoImpl,
    });
    yield { type: "preflight_memory_fit", ...fit.event };
    if (fit.action === "skip") {
      yield {
        type: "error",
        layer: "orchestrator",
        code: "skipped_wont_fit",
        message: `skipped: ${fit.event.reason}`,
      };
      yield { type: "run_finished", run_id: rid };
      return;
    }
    if (fit.action === "unload_other_models") {
      const seen = new Set<string>();
      for (const inst of fit.residentInstances) {
        if (seen.has(inst.modelKey)) continue; // 모델당 1회 — lmStudioUnload가 인스턴스 전부 회수
        seen.add(inst.modelKey);
        const u = await lmStudioUnload(base, inst.modelKey, { fetchImpl, apiKey: input.apiKey });
        yield {
          type: "model_unloaded",
          model_id: inst.modelKey,
          phase: "preflight_fit",
          ok: u.ok,
          status: u.status,
        };
      }
      preflightUnloadedResidents = true;
    }
  }

  if (
    input.provider === "lm_studio" &&
    !input.skipModelLoad &&
    input.unloadOtherModels &&
    !preflightUnloadedResidents // 프리플라이트가 이미 회수했으면 중복 언로드 방지
  ) {
    for (const m of detect.models) {
      if (m.id === input.modelId) continue;
      await lmStudioUnload(base, m.id, { fetchImpl, apiKey: input.apiKey });
    }
  }

  let modelLoadedByThisBench = false;
  if (input.provider === "lm_studio" && !input.skipModelLoad) {
    const loaded = await lmStudioIsModelLoaded(base, input.modelId, {
      fetchImpl,
      apiKey: input.apiKey,
    });
    if (loaded.ok && loaded.loaded) {
      /* already in memory — do not load or auto-unload at end */
    } else {
      await lmStudioUnload(base, input.modelId, {
        fetchImpl,
        apiKey: input.apiKey,
      });
      const load = await lmStudioLoad(base, input.modelId, {
        fetchImpl,
        apiKey: input.apiKey,
      });
      if (!load.ok) {
        yield {
          type: "error",
          layer: "orchestrator",
          code: "load_failed",
          message: `LM Studio load failed: ${load.status} ${load.body}`,
        };
        return;
      }
      modelLoadedByThisBench = true;
    }
  }

  let lmStudioPrepare:
    | "loaded"
    | "already_in_memory"
    | "load_skipped_by_request"
    | undefined;
  if (input.provider === "lm_studio") {
    if (input.skipModelLoad) lmStudioPrepare = "load_skipped_by_request";
    else if (modelLoadedByThisBench) lmStudioPrepare = "loaded";
    else lmStudioPrepare = "already_in_memory";
  }

  yield {
    type: "model_loaded",
    model_id: input.modelId,
    provider: input.provider,
    ...(lmStudioPrepare != null ? { lm_studio_prepare: lmStudioPrepare } : {}),
  };

  // STEP 1: 사전 대기 게이트 — 다른 추론이 실행 중이면 유휴까지 대기. 타임아웃/예산 초과면
  // 오염 수치를 만들지 않고 즉시 중단(단일 요약 인라인 — 이 경로는 STEP 7에 도달 못 함).
  if (contentionCfg.enabled) {
    const pre = yield* runIdleGate(contentionProbe, contentionCfg, clock, {
      phase: "pre_bench",
      waitAccum,
    });
    guardEffective = pre.effective;
    gpuSignalAvailable = pre.gpuSignalAvailable;
    maxPreWait = Math.max(maxPreWait, pre.waitedMs);
    if (!pre.idle) {
      const code = pre.code ?? "pre_bench_wait_timeout";
      yield {
        type: "error",
        layer: "orchestrator",
        code,
        message: `다른 추론이 실행 중이라 대기 한도(${code})를 넘겨 벤치를 시작하지 못했습니다.`,
      };
      yield {
        type: "contention_summary",
        total_iterations_discarded: 0,
        max_pre_bench_wait_ms: maxPreWait,
        max_between_iteration_wait_ms: 0,
        total_wait_ms: waitAccum.total,
        guard_effective: guardEffective,
        gpu_signal_available: gpuSignalAvailable,
        abort_reason: code,
      };
      return;
    }
  }
  const guardActive = contentionCfg.enabled && guardEffective;

  try {
    let fatalStop = false;
    for (const api_route of meta.api_routes) {
      if (fatalStop) break;
      for (const scenarioId of meta.scenario_ids as ScenarioId[]) {
        if (fatalStop) break;
        if (api_route === "messages" && scenarioId === "tool_weather") {
          /* Anthropic tools format differs; still attempt with converted tools in body */
        }
        const runs: {
          ttft_ms: number | null;
          total_ms: number;
          output_text: string;
          stream_completed: boolean;
          usage_output_tokens: number | null;
          reasoning_hidden?: boolean;
          /** #1922: 스트리밍 tool_call 인자가 연결 손상(`{}{}`)돼 감지된 경우 — LM Studio 엔진 프로토콜 회귀 신호. */
          tool_call_args_corrupted?: boolean;
          /** 추론이 `reasoning_content` 대신 `content`로 새어 들어온 경우(chat 라우트) — 엔진 프로토콜 회귀 신호. */
          reasoning_leaked_into_content?: boolean;
          /** #80: 분리된 reasoning 채널의 raw 문자 수(thinking_leak_ratio 집계 분자). */
          reasoning_chars?: number;
          /** #80: 가시 content 비었고 tool_call 없음 → 에이전트 정체(empty_turn). */
          empty_response?: boolean;
          /** #80: 가시 content에 <think>/<|channel|> 태그 잔존(라우트 무관). */
          channel_tag_leak_detected?: boolean;
          /** #79: agent_loop 메트릭. */
          empty_turn_count?: number;
          turns_to_completion?: number | null;
          valid_tool_call_rate?: number;
          intermediate_turn_leak?: boolean;
          /** #101: 사고가 per-turn max_tokens 를 소진해 빈 content 로 끝난 턴이 있었는지(no_signal 시그니처). */
          thinking_exhausted_budget?: boolean;
          /** #105: argDispatch 인자 충실도 원자료(도구 없으면 필드 부재 = 레거시/미측정). */
          tool_arg_hits?: number;
          tool_arg_attempts?: number;
          /** #105: 최종(무도구) 턴 출력 토큰(효율 분자). */
          final_turn_output_tokens?: number;
          /** #108 후속: 도구별 실제 호출 횟수(재시도 실측·워크플로 준수율). */
          tool_call_counts?: Record<string, number>;
          agent_completion_reason?: "completed" | "stall" | "budget_exhausted";
          quality?: { pass: boolean; score?: number; reason?: string };
        }[] = [];

        const totalIterations = meta.warmup_runs + meta.measured_runs;
        /** 집계 `runs`의 마지막 측정 런과 동일한 참조를 쓴 user 프롬프트 스냅샷 */
        let lastUserPromptForAggregate = "";
        /** 집계 `runs`의 마지막 측정 런과 동일한 system 프롬프트 스냅샷 */
        let lastSystemPromptForAggregate = "";
        // 오염 가드: i를 수동 증가시켜 폐기 시 같은 i를 재실행한다(STEP 2/6).
        let i = 0;
        let contentionRetries = 0;
        while (i < totalIterations) {
          const isWarmup = i < meta.warmup_runs;
          const ref = new Date();
          const visionThisRun = isVisionScenario(scenarioId);

          // D7: 비전 시나리오는 warmup 단계에서 호출하지 않는다 — 이미지
          // 인코딩·멀티모달 API 비용을 warmup에서 중복시키지 않음.
          if (isWarmup && visionThisRun) {
            i++;
            continue;
          }
          // STEP 3: 이터레이션 간 유휴 게이트(워밍업 포함 모든 이터). 타임아웃/예산 초과면 런 중단.
          let segBaseline: InFlightBaseline | null = null;
          if (contentionCfg.enabled) {
            const gate = yield* runIdleGate(contentionProbe, contentionCfg, clock, {
              phase: "between_iterations",
              scenarioId,
              apiRoute: api_route,
              waitAccum,
            });
            maxBetweenWait = Math.max(maxBetweenWait, gate.waitedMs);
            if (!gate.idle) {
              contentionAbortReason = gate.code ?? "between_iteration_wait_timeout";
              yield {
                type: "error",
                layer: "orchestrator",
                code: contentionAbortReason,
                message: `다른 추론 대기 한도(${contentionAbortReason})를 넘겨 벤치를 중단합니다.`,
                partial: { scenarioId, api_route },
              };
              fatalStop = true;
              break;
            }
            segBaseline = gate.baseline ?? null;
          }
          const measuredGuarded = guardActive && !isWarmup && segBaseline != null;
          /** STEP 5/6: 이번 이터가 경합으로 오염됐는가(측정 런에서만 true 가능). */
          let contentionThisIteration = false;
          const contentionController = new AbortController();
          const contentionMonitor = { detected: false, reasons: [] as string[] };

          const promptCtx = {
            publicAssetsOrigin: assetOrigin,
            referenceAt: ref,
            calendarTimeZone: DEFAULT_CALENDAR_TIMEZONE,
          };
          const scenarioMeta = makeScenarioBenchRunMeta(
            input,
            detect,
            meta.run_id,
            scenarioId,
          );
          const stripThinkHistory =
            scenarioMeta.prompt_rules_applied
              ?.stripThinkingFromAssistantHistory === true;
          let systemPromptThisRun = scenarioSystemMessageContent(scenarioId);
          if (
            scenarioMeta.prompt_rules_applied?.gemmaThinkToken &&
            scenarioMeta.profile_thinking_intent !== "off"
          ) {
            const token = "<|think|>";
            if (!systemPromptThisRun.includes(token)) {
              systemPromptThisRun = `${token}${systemPromptThisRun}`;
            }
          }
          const userPromptThisRun = scenarioUserMessageContent(scenarioId, promptCtx);
          lastSystemPromptForAggregate = systemPromptThisRun;
          lastUserPromptForAggregate = userPromptThisRun;
          const visionMaxTokens = visionThisRun
            ? defaultMaxTokensForVisionScenario(scenarioId)
            : null;
          if (visionMaxTokens) {
            // vision default는 *floor*로만 작동. 세 source 중 가장 큰 값을 사용:
            //   1) `BenchRequest.max_tokens` (UI top-level 입력)
            //   2) `scenarioMeta.max_tokens` (profile augmentation 후 — profileMaxTokens 또는
            //      프로파일 권장값)
            //   3) vision default (이 줄의 floor)
            // profile augmentation이 BenchRequest.max_tokens을 무시하므로 (1)을 명시 비교.
            const userTopLevel = input.max_tokens ?? 0;
            scenarioMeta.max_tokens = Math.max(userTopLevel, scenarioMeta.max_tokens, visionMaxTokens);
          }
          const visionImageDelivery: "base64" | "url" | undefined = visionThisRun
            ? (isLoopbackOrPrivateOrigin(assetOrigin) ? "base64" : "url")
            : undefined;
          const visionRefs = visionThisRun ? visionImageRefs(scenarioId) : undefined;
          yield {
            type: "scenario_start",
            scenario_id: scenarioId,
            api_route,
            system_prompt: systemPromptThisRun,
            user_prompt: userPromptThisRun,
            ...(visionRefs ? { image_refs: visionRefs } : {}),
            ...(visionImageDelivery ? { image_delivery: visionImageDelivery } : {}),
          };

          let iterationFailed = false;
          /** D5: 비전 시나리오에서 400 + image/vision/multimodal 본문 매칭 시 채워짐.
              quality.reason을 `upstream_no_vision: ...`로 덮어쓰는 데 사용. */
          let upstreamNoVisionDetail: string | null = null;
          /** C: 4개 stream consume 분기에서 `finish_reason: "length"` 또는
              `stop_reason: "max_tokens"`가 감지되면 true. quality.reason에
              `truncated_at_max_tokens=N` prefix를 붙이는 데 사용. */
          let truncated = false;
          /** Part 3: OpenAI 스트림에서 반복 루프가 감지돼 reader.cancel()로 조기 종료된 경우. measured run에서
              quality를 `repetition_loop_aborted`로 hard-fail(pass:false, score:0) override 한다. */
          let repetitionLoopAborted = false;
          const controller = new AbortController();
          const to = setTimeout(() => controller.abort(), requestTimeoutMs);
          // STEP 4: 결합 시그널 — 타임아웃 OR 오염 감지로 in-flight 요청을 중단.
          const reqSignal: AbortSignal = measuredGuarded
            ? AbortSignal.any([controller.signal, contentionController.signal])
            : controller.signal;
          // STEP 4: 구간-스코프 in-flight 모니터. upstream 요청/스트림 구간에만 켜고
          // 채점·judge 전에 끈다(오탐 차단). teardown은 stopMonitor()가 책임.
          // async — in-flight 샘플이 teardown과 경쟁하더라도 양성 탐지를 잃지 않도록 await한다.
          let stopMonitor: () => Promise<void> = async () => {};
          if (measuredGuarded && segBaseline) {
            stopMonitor = startInflightMonitor({
              probe: contentionProbe,
              baseline: segBaseline,
              cfg: contentionCfg,
              clock,
              onDetect: (reasons) => {
                contentionMonitor.detected = true;
                contentionMonitor.reasons = reasons;
                contentionController.abort();
              },
            });
          }

          try {
            let text = "";
            /** 채점 전용 텍스트. null이면 `text` 사용. Anthropic 경로에서 추론(thinking)을 제외한
                가시 본문+tool JSON으로 설정해 채점을 오염시키지 않으면서, `text`(output_text/throughput)는
                추론을 포함하도록 분리한다. */
            let scoreText: string | null = null;
            let ttft: number | null = null;
            let totalMs = 0;
            let streamCompleted = false;
            /** provider 보고 출력 토큰 수(없으면 null). TPS·reasoning_hidden 계산에 사용. */
            let usageOutputTokens: number | null = null;
            /** 가시 추론(reasoning/thinking 델타) 누적 길이. 0이면 추론이 스트림에 노출되지 않음. */
            let reasoningChars = 0;
            /** 어느 OpenAI 스트림 라운드에서든 tool_call 인자 연결 손상(#1922)이 한 번이라도 감지되면 true(OR-집계). */
            let toolArgsCorruptedAny = false;
            /** 최종 OpenAI(chat) 스트림 메트릭 — reasoning-누수 판정에 raw assistantText/reasoningText로 사용. */
            let lastOpenAiMetrics: OpenAiStreamMetrics | null = null;
            const invokedBenchTools: string[] = [];
            let agentMetrics: AgentLoopMetrics | null = null;

            const agentLoopDefForRun = getScenarioDef(scenarioId);
            if (agentLoopDefForRun?.agentLoop) {
              // #79: 선언형 멀티턴 agent_loop 하네스(mock 도구). token_delta/error 이벤트를 그대로 흘려보낸다.
              const harnessArgs = {
                base,
                apiKey: input.apiKey,
                model: input.modelId,
                def: agentLoopDefForRun,
                meta: scenarioMeta,
                scenarioId,
                fetchImpl,
                signal: reqSignal,
                requestStartedAt: performance.now(),
                maxTokens: scenarioMeta.max_tokens,
                temperature: scenarioMeta.temperature,
              };
              const gen =
                api_route === "chat_completions"
                  ? runAgentLoopOpenAi(harnessArgs)
                  : runAgentLoopAnthropic(harnessArgs);
              let step = await gen.next();
              while (!step.done) {
                yield step.value;
                step = await gen.next();
              }
              const ar = step.value;
              text = ar.text;
              scoreText = ar.scoreText;
              ttft = ar.ttft;
              totalMs = ar.totalMs;
              streamCompleted = ar.streamCompleted;
              usageOutputTokens = ar.usageOutputTokens;
              reasoningChars = ar.reasoningChars;
              toolArgsCorruptedAny = ar.toolArgsCorruptedAny;
              agentMetrics = ar.metrics;
            } else if (
              api_route === "chat_completions" &&
              isTranslateNistFips197PdfToolsScenario(scenarioId)
            ) {
              const bm = prepareOpenAiMessages(
                scenarioId,
                promptCtx,
                scenarioMeta,
              );
              const messages: unknown[] = [...bm.messages];
              const tools = bm.tools;
              const tool_choice = bm.tool_choice ?? "auto";
              let totalMsAcc = 0;
              let lastOpen: Awaited<
                ReturnType<typeof consumeOpenAiChatStream>
              > | null = null;
              for (let round = 0; round < MAX_BENCH_TOOL_ROUNDS; round++) {
                const body = mergeOpenAiBody(scenarioMeta, {
                  model: input.modelId,
                  messages,
                  temperature: scenarioMeta.temperature,
                  max_tokens: scenarioMeta.max_tokens,
                  stream: true,
                  ...(tools ? { tools, tool_choice } : {}),
                });
                const requestT0 = performance.now();
                const { response: r } = await openAiChatPostWithUsage(
                  fetchImpl,
                  `${base}/v1/chat/completions`,
                  base,
                  headers(input.apiKey),
                  body,
                  reqSignal,
                );
                if (r.status === 429) {
                  yield {
                    type: "error",
                    layer: "upstream",
                    code: "429",
                    message: "Rate limited",
                    partial: { scenarioId, api_route },
                  };
                  iterationFailed = true;
                  break;
                }
                if (!r.ok || !r.body) {
                  const errText = await r.text().catch(() => "");
                  yield {
                    type: "error",
                    layer: "upstream",
                    code: String(r.status),
                    message: errText.slice(0, 500),
                    partial: { scenarioId, api_route },
                  };
                  iterationFailed = true;
                  break;
                }
                const m = await consumeOpenAiChatStream(
                  r.body,
                  reqSignal,
                  { loopGuard: true, requestStartedAt: requestT0 },
                );
                lastOpen = m;
                lastOpenAiMetrics = m;
                if (m.toolCallArgsCorrupted) toolArgsCorruptedAny = true;
                if (openAiLikelyTruncated(m, scenarioMeta.max_tokens)) truncated = true;
                if (m.repetitionLoopDetected) repetitionLoopAborted = true;
                totalMsAcc += m.totalMs;
                if (ttft === null) ttft = m.ttftMs;
                streamCompleted = m.streamCompleted;
                for (const ch of chunkTextForUi(openAiLiveTokenStreamText(m), 24)) {
                  yield {
                    type: "token_delta",
                    scenario_id: scenarioId,
                    text: ch,
                  };
                }
                // 반복 루프 감지 시 부분 출력을 기록하고 추가 도구 라운드 없이 즉시 탈출.
                if (repetitionLoopAborted) {
                  text = openAiBenchOutputText(m);
                  break;
                }
                if (m.toolCalls?.length) {
                  const assistantContent = sanitizeOpenAiAssistantContent(
                    m.assistantText.trim() ? m.assistantText : null,
                    stripThinkHistory,
                  );
                  const assistantMsg: Record<string, unknown> = {
                    role: "assistant",
                    content: assistantContent,
                    tool_calls: m.toolCalls.map((tc) => ({
                      id: tc.id,
                      type: "function",
                      function: {
                        name: tc.function.name,
                        arguments: tc.function.arguments,
                      },
                    })),
                  };
                  const eb = scenarioMeta.extra_body;
                  if (
                    eb &&
                    typeof eb === "object" &&
                    (eb as { reasoning_split?: unknown }).reasoning_split === true &&
                    m.reasoningText.trim()
                  ) {
                    assistantMsg.reasoning_details = minimaxReasoningDetailsForOpenAiHistory(
                      m.reasoningText,
                    );
                  }
                  messages.push(assistantMsg);
                  for (const tc of m.toolCalls) {
                    const toolContent = await executeBenchTool(
                      tc.function.name,
                      tc.function.arguments,
                      fetchImpl,
                      assetOrigin,
                    );
                    if (!invokedBenchTools.includes(tc.function.name)) {
                      invokedBenchTools.push(tc.function.name);
                    }
                    messages.push({
                      role: "tool",
                      tool_call_id: tc.id,
                      content: toolContent,
                    });
                  }
                  continue;
                }
                text = openAiBenchOutputText(m);
                break;
              }
              if (!iterationFailed) {
                totalMs = totalMsAcc;
                if (lastOpen) {
                  usageOutputTokens = lastOpen.usageOutputTokens;
                  reasoningChars = lastOpen.reasoningText.length;
                  if (!text.trim()) text = openAiBenchOutputText(lastOpen);
                }
              }
            } else if (
              api_route === "messages" &&
              isTranslateNistFips197PdfToolsScenario(scenarioId)
            ) {
              const am = prepareAnthropicScenario(
                scenarioId,
                promptCtx,
                scenarioMeta,
              );
              const anthropicMessages: unknown[] = am.messages.map((x) => ({
                ...x,
              }));
              const toolsAnthropic = anthropicToolsForScenario(scenarioId);
              let totalMsAcc = 0;
              let lastAnth: Awaited<
                ReturnType<typeof consumeAnthropicMessagesStream>
              > | null = null;
              for (let round = 0; round < MAX_BENCH_TOOL_ROUNDS; round++) {
                const body: Record<string, unknown> = {
                  model: input.modelId,
                  max_tokens: scenarioMeta.max_tokens,
                  temperature: scenarioMeta.temperature,
                  messages: anthropicMessages,
                  stream: true,
                };
                if (am.system) body.system = am.system;
                if (toolsAnthropic) body.tools = toolsAnthropic;
                Object.assign(body, anthropicExtrasFromMeta(scenarioMeta));
                const requestT0 = performance.now();
                const r = await fetchImpl(`${base}/v1/messages`, {
                  method: "POST",
                  headers: headers(input.apiKey, {
                    "anthropic-version": "2023-06-01",
                  }),
                  body: JSON.stringify(body),
                  signal: reqSignal,
                });
                if (!r.ok || !r.body) {
                  const errText = await r.text().catch(() => "");
                  yield {
                    type: "error",
                    layer: "upstream",
                    code: String(r.status),
                    message: errText.slice(0, 500),
                    partial: { scenarioId, api_route },
                  };
                  iterationFailed = true;
                  break;
                }
                const m = await consumeAnthropicMessagesStream(
                  r.body,
                  reqSignal,
                  { requestStartedAt: requestT0 },
                );
                lastAnth = m;
                if (m.stopReason === "max_tokens") truncated = true;
                totalMsAcc += m.totalMs;
                if (ttft === null) ttft = m.ttftMs;
                streamCompleted = m.streamCompleted;
                for (const ch of chunkTextForUi(m.assistantText, 24)) {
                  yield {
                    type: "token_delta",
                    scenario_id: scenarioId,
                    text: ch,
                  };
                }
                if (m.toolUses?.length) {
                  const atext = stripThinkHistory
                    ? stripThinkingBlocks(m.assistantText)
                    : m.assistantText;
                  anthropicMessages.push({
                    role: "assistant",
                    content: [
                      ...(atext.trim() ? [{ type: "text", text: atext }] : []),
                      ...m.toolUses.map((tu) => ({
                        type: "tool_use",
                        id: tu.id,
                        name: tu.name,
                        input: tu.input,
                      })),
                    ],
                  });
                  const toolResults = [];
                  for (const tu of m.toolUses) {
                    const toolContent = await executeBenchTool(
                      tu.name,
                      JSON.stringify(tu.input ?? {}),
                      fetchImpl,
                      assetOrigin,
                    );
                    if (!invokedBenchTools.includes(tu.name)) {
                      invokedBenchTools.push(tu.name);
                    }
                    toolResults.push({
                      type: "tool_result",
                      tool_use_id: tu.id,
                      content: toolContent,
                    });
                  }
                  anthropicMessages.push({
                    role: "user",
                    content: toolResults,
                  });
                  continue;
                }
                scoreText = m.assistantText;
                text = m.reasoningText ? `${m.reasoningText}${m.assistantText}` : m.assistantText;
                break;
              }
              if (!iterationFailed) {
                totalMs = totalMsAcc;
                if (lastAnth) {
                  usageOutputTokens = lastAnth.usageOutputTokens;
                  reasoningChars = lastAnth.reasoningText.length;
                  if (!text) text = lastAnth.assistantText;
                }
              }
            } else if (api_route === "chat_completions") {
              const { messages, tools, tool_choice } = prepareOpenAiMessages(
                scenarioId,
                promptCtx,
                scenarioMeta,
              );
              const body = mergeOpenAiBody(scenarioMeta, {
                model: input.modelId,
                messages,
                temperature: scenarioMeta.temperature,
                max_tokens: scenarioMeta.max_tokens,
                stream: true,
                ...(tools ? { tools, tool_choice: tool_choice ?? "auto" } : {}),
              });
              const requestT0 = performance.now();
              const { response: r } = await openAiChatPostWithUsage(
                fetchImpl,
                `${base}/v1/chat/completions`,
                base,
                headers(input.apiKey),
                body,
                reqSignal,
              );
              if (r.status === 429) {
                yield {
                  type: "error",
                  layer: "upstream",
                  code: "429",
                  message: "Rate limited",
                  partial: { scenarioId, api_route },
                };
                iterationFailed = true;
              }
              if (!iterationFailed && (!r.ok || !r.body)) {
                const errText = await r.text().catch(() => "");
                if (
                  visionThisRun &&
                  r.status === 400 &&
                  /image|vision|multimodal/i.test(errText)
                ) {
                  upstreamNoVisionDetail = errText.slice(0, 80);
                }
                yield {
                  type: "error",
                  layer: "upstream",
                  code: String(r.status),
                  message: errText.slice(0, 500),
                  partial: { scenarioId, api_route },
                };
                iterationFailed = true;
              }
              if (!iterationFailed) {
                const m = await consumeOpenAiChatStream(
                  r.body,
                  reqSignal,
                  { loopGuard: true, requestStartedAt: requestT0 },
                );
                text = m.text;
                ttft = m.ttftMs;
                totalMs = m.totalMs;
                streamCompleted = m.streamCompleted;
                usageOutputTokens = m.usageOutputTokens;
                reasoningChars = m.reasoningText.length;
                lastOpenAiMetrics = m;
                if (m.toolCallArgsCorrupted) toolArgsCorruptedAny = true;
                if (openAiLikelyTruncated(m, scenarioMeta.max_tokens)) truncated = true;
                if (m.repetitionLoopDetected) repetitionLoopAborted = true;
                for (const ch of chunkTextForUi(text, 24)) {
                  yield {
                    type: "token_delta",
                    scenario_id: scenarioId,
                    text: ch,
                  };
                }
              }
            } else {
              const am = prepareAnthropicScenario(
                scenarioId,
                promptCtx,
                scenarioMeta,
              );
              const toolsAnthropic = anthropicToolsForScenario(scenarioId);
              const body: Record<string, unknown> = {
                model: input.modelId,
                max_tokens: scenarioMeta.max_tokens,
                temperature: scenarioMeta.temperature,
                messages: am.messages,
                stream: true,
              };
              if (am.system) body.system = am.system;
              if (toolsAnthropic) body.tools = toolsAnthropic;
              Object.assign(body, anthropicExtrasFromMeta(scenarioMeta));

              const requestT0 = performance.now();
              const r = await fetchImpl(`${base}/v1/messages`, {
                method: "POST",
                headers: headers(input.apiKey, {
                  "anthropic-version": "2023-06-01",
                }),
                body: JSON.stringify(body),
                signal: reqSignal,
              });
              if (!r.ok || !r.body) {
                const errText = await r.text().catch(() => "");
                if (
                  visionThisRun &&
                  r.status === 400 &&
                  /image|vision|multimodal/i.test(errText)
                ) {
                  upstreamNoVisionDetail = errText.slice(0, 80);
                }
                yield {
                  type: "error",
                  layer: "upstream",
                  code: String(r.status),
                  message: errText.slice(0, 500),
                  partial: { scenarioId, api_route },
                };
                iterationFailed = true;
              }
              if (!iterationFailed) {
                const m = await consumeAnthropicMessagesStream(
                  r.body,
                  reqSignal,
                  { requestStartedAt: requestT0 },
                );
                // 채점: 추론 제외(가시 본문 + tool JSON). output_text/throughput: 추론 포함(chat 경로와 동일).
                scoreText = m.text;
                text = m.reasoningText ? `${m.reasoningText}${m.text}` : m.text;
                ttft = m.ttftMs;
                totalMs = m.totalMs;
                streamCompleted = m.streamCompleted;
                usageOutputTokens = m.usageOutputTokens;
                reasoningChars = m.reasoningText.length;
                if (m.stopReason === "max_tokens") truncated = true;
                for (const ch of chunkTextForUi(text, 24)) {
                  yield {
                    type: "token_delta",
                    scenario_id: scenarioId,
                    text: ch,
                  };
                }
              }
            }

            // STEP 4/5: 스트리밍 종료 → 모니터 정지(채점·judge는 감시 안 함). 경합 감지 시 측정 폐기.
            await stopMonitor();
            if (measuredGuarded && contentionMonitor.detected) {
              contentionThisIteration = true;
            }
            if (!contentionThisIteration) {
            let quality:
              | { pass: boolean; score?: number; reason?: string; judge_pending?: true }
              | undefined = isWarmup
              ? undefined
              : scoreScenario(scenarioId, scoreText ?? text, {
                  invokedBenchTools,
                  calendarReferenceIso: ref.toISOString(),
                  calendarTimeZone: DEFAULT_CALENDAR_TIMEZONE,
                  // #105: 결정론 채점기가 정체 여부·도구 사용 증거를 rubric 에 반영한다.
                  // 메트릭 필드명은 `completion_reason`(저장/emit 시엔 `agent_completion_reason`).
                  ...(agentMetrics
                    ? {
                        agent: {
                          completionReason: agentMetrics.completion_reason,
                          toolArgAttempts: agentMetrics.tool_arg_attempts,
                          toolArgHits: agentMetrics.tool_arg_hits,
                          toolCallCounts: agentMetrics.tool_call_counts,
                        },
                      }
                    : {}),
                });
            // D5: 비전 시나리오에서 400 + image/vision/multimodal 본문 매칭이 감지된 경우
            // scoreScenario의 결과(빈 출력 → 0점)를 `upstream_no_vision`로 덮어쓴다.
            if (!isWarmup && quality && upstreamNoVisionDetail) {
              quality = {
                pass: false,
                score: 0,
                reason: `upstream_no_vision: ${upstreamNoVisionDetail}`,
              };
            } else if (
              !isWarmup &&
              quality &&
              isJudgeEnabled() &&
              quality.judge_pending === true
            ) {
              // #79/#83: 레지스트리 시나리오는 텍스트/산출물 judge, 그 외(비전)는 이미지 judge.
              const regDef = getScenarioDef(scenarioId);
              quality = regDef?.judge
                ? await runJudgeForRegisteredScenario(regDef, scoreText ?? text, fetchImpl)
                : await runJudgeForVisionScenario(scenarioId, text, fetchImpl);
            }
            // emit 직전 내부 플래그 제거 — SSE/DB에는 노출되지 않게 한다.
            if (quality && quality.judge_pending === true) {
              const { judge_pending: _drop, ...rest } = quality;
              void _drop;
              quality = rest;
            }
            // Part 3: 반복 루프로 조기 종료된 경우 — quality를 hard-fail로 통째 교체(부분 출력에 정답이 있어도
            // 무효). upstream_no_vision과 동일한 override 패턴이며, 아래 truncated soft prefix보다 우선한다.
            if (!isWarmup && quality && repetitionLoopAborted && !upstreamNoVisionDetail) {
              quality = {
                pass: false,
                score: 0,
                reason: "repetition_loop_aborted",
              };
            }
            // C-3: max_tokens 잘림이 발생한 경우 quality.reason에 prefix 추가.
            // `upstream_no_vision`은 이미 quality 전체를 교체했으므로 prefix 미적용.
            // `image_too_large`는 try/catch 분기에서 별도 emit 경로라 이 코드를 거치지 않음.
            // 반복 루프 hard-fail이 이미 적용된 경우(repetitionLoopAborted)에는 soft prefix를 생략한다.
            if (
              !isWarmup &&
              quality &&
              truncated &&
              !upstreamNoVisionDetail &&
              !repetitionLoopAborted
            ) {
              const tokens = scenarioMeta.max_tokens;
              const prevReason = quality.reason ?? "";
              quality = {
                ...quality,
                reason: prevReason
                  ? `truncated_at_max_tokens=${tokens} | ${prevReason}`
                  : `truncated_at_max_tokens=${tokens}`,
              };
            }
            // Part B: messages 라우트에서 provider가 추론을 숨긴 채 측정됐는지 판정.
            // 가시 추론 없음(reasoningChars===0) + 실토큰이 가시 추정의 2배↑ → 숨은 추론으로 보고
            // TTFT가 "첫 가시 토큰까지(숨은 추론 포함)"임을 UI에 경고. char/4 과소추정 오탐을 K=2로 방어.
            const reasoningHidden =
              api_route === "messages" &&
              usageOutputTokens != null &&
              reasoningChars === 0 &&
              usageOutputTokens >= 2 * approxOutputTokens(text);

            // reasoning-누수(chat 라우트): 분리 채널 추론이 전혀 없는데(reasoningText 비어있음) content(assistantText)에
            // 사고 블록 마커가 있으면 추론이 content로 오라벨돼 새어 들어온 것. reasoning_hidden(messages·추론 숨김)과 상보적.
            // 폴백 혼합 텍스트(openAiBenchOutputText)가 아니라 raw assistantText/reasoningText로 판정한다.
            const reasoningLeaked =
              api_route === "chat_completions" &&
              lastOpenAiMetrics != null &&
              lastOpenAiMetrics.reasoningText.trim() === "" &&
              stripThinkingBlocks(lastOpenAiMetrics.assistantText) !==
                lastOpenAiMetrics.assistantText.trim();

            // #80: 라우트 무관 누수/정체 신호(scoreboard·stats 집계 입력).
            // - channelTagLeak: 가시 content에 <think>/<|channel|> 태그가 남음(stripThinkingBlocks는 이미 trim).
            //   reasoning_leaked_into_content(chat·분리채널 비어있을 때만)의 일반화 — 모든 라우트에서 판정.
            // - emptyResponse: 가시 content 비었고 tool_call도 없음 → 에이전트 정체(empty_turn).
            const visibleText = scoreText ?? text;
            const channelTagLeak = stripThinkingBlocks(visibleText) !== visibleText.trim();
            const emptyResponse =
              stripThinkingBlocks(visibleText) === "" && invokedBenchTools.length === 0;

            if (!isWarmup) {
              runs.push({
                ttft_ms: ttft,
                total_ms: totalMs,
                output_text: text,
                stream_completed: streamCompleted,
                usage_output_tokens: usageOutputTokens,
                ...(reasoningHidden ? { reasoning_hidden: true } : {}),
                ...(toolArgsCorruptedAny ? { tool_call_args_corrupted: true } : {}),
                ...(reasoningLeaked ? { reasoning_leaked_into_content: true } : {}),
                ...(reasoningChars > 0 ? { reasoning_chars: reasoningChars } : {}),
                ...(emptyResponse ? { empty_response: true } : {}),
                ...(channelTagLeak ? { channel_tag_leak_detected: true } : {}),
                ...(agentMetrics
                  ? {
                      empty_turn_count: agentMetrics.empty_turn_count,
                      turns_to_completion: agentMetrics.turns_to_completion,
                      valid_tool_call_rate: agentMetrics.valid_tool_call_rate,
                      ...(agentMetrics.intermediate_turn_leak ? { intermediate_turn_leak: true } : {}),
                      ...(agentMetrics.thinking_exhausted_budget ? { thinking_exhausted_budget: true } : {}),
                      // #105: argDispatch 도구가 있을 때만(null 아님) 카운터 저장 → 레거시/미측정 런은 필드 부재.
                      ...(agentMetrics.tool_arg_attempts != null
                        ? { tool_arg_attempts: agentMetrics.tool_arg_attempts, tool_arg_hits: agentMetrics.tool_arg_hits ?? 0 }
                        : {}),
                      ...(agentMetrics.final_turn_output_tokens != null
                        ? { final_turn_output_tokens: agentMetrics.final_turn_output_tokens }
                        : {}),
                      ...(Object.keys(agentMetrics.tool_call_counts ?? {}).length
                        ? { tool_call_counts: agentMetrics.tool_call_counts }
                        : {}),
                      agent_completion_reason: agentMetrics.completion_reason,
                    }
                  : {}),
                quality,
              });
            }

            yield {
              type: "scenario_end",
              scenario_id: scenarioId,
              api_route,
              metrics: {
                ttft_ms: ttft,
                total_ms: totalMs,
                output_chars: text.length,
                approx_tokens: Math.ceil(text.length / 4),
                usage_output_tokens: usageOutputTokens,
                stream_completed: streamCompleted,
              },
              quality,
            };
            }
          } catch (e) {
            await stopMonitor();
            if (measuredGuarded && isAbortLikeError(e) && contentionMonitor.detected) {
              // STEP 5: 오염 abort는 request_timeout으로 매핑하지 않고 폐기·재측정 경로로.
              contentionThisIteration = true;
            } else {
            const errMsg = String(e);
            // A5: vision-assets가 1MB 초과 자산에서 throw하는 `image_too_large:` prefix를
            // 캐치해 quality로 라벨링한다. 일반 `upstream_exception`과 구분.
            const isImageTooLarge = errMsg.startsWith("Error: image_too_large:") || errMsg.includes("image_too_large:");
            const code = isImageTooLarge
              ? "image_too_large"
              : isAbortLikeError(e)
                ? "request_timeout"
                : "upstream_exception";
            const message = isImageTooLarge
              ? errMsg
              : isAbortLikeError(e)
                ? `요청이 ${Math.floor(requestTimeoutMs / 1000)}초 제한을 넘어 중단되었습니다 (${errMsg})`
                : errMsg;
            yield {
              type: "error",
              layer: "upstream",
              code,
              message,
              partial: { scenarioId, api_route },
            };
            iterationFailed = true;
            if (isImageTooLarge && !isWarmup) {
              const quality = {
                pass: false,
                score: 0,
                reason: `image_too_large: ${errMsg.replace(/^Error:\s*/, "").slice(0, 120)}`,
              };
              runs.push({
                ttft_ms: null,
                total_ms: 0,
                output_text: "",
                stream_completed: false,
                usage_output_tokens: null,
                quality,
              });
              yield {
                type: "scenario_end",
                scenario_id: scenarioId,
                api_route,
                metrics: {
                  ttft_ms: null,
                  total_ms: 0,
                  output_chars: 0,
                  approx_tokens: 0,
                  stream_completed: false,
                },
                quality,
              };
            }
            }
          } finally {
            await stopMonitor();
            clearTimeout(to);
          }

          // STEP 6: 오염 폐기·재측정. measured 런에서만 도달(워밍업 모니터 OFF).
          if (contentionThisIteration) {
            totalDiscarded++;
            const willRetry = contentionRetries < contentionCfg.maxRetriesPerIteration;
            yield {
              type: "iteration_discarded",
              scenario_id: scenarioId,
              api_route,
              measured_index: i - meta.warmup_runs,
              retry_count: contentionRetries,
              max_retries: contentionCfg.maxRetriesPerIteration,
              will_retry: willRetry,
              reason: contentionMonitor.reasons[0] ?? "contention",
              reasons: contentionMonitor.reasons,
            };
            if (willRetry) {
              contentionRetries++;
              continue; // 같은 i 재실행(runs 무손상, i 미증가)
            }
            // 재시도 한도 초과 → 런 중단. contention_summary는 STEP 7 단일 발행.
            contentionAbortReason = "contention_max_retries_exceeded";
            yield {
              type: "error",
              layer: "orchestrator",
              code: contentionAbortReason,
              message: `시나리오 ${scenarioId}/${api_route} 측정 런 ${i - meta.warmup_runs}이(가) 반복 오염되어 벤치를 중단합니다.`,
              partial: { scenarioId, api_route },
            };
            fatalStop = true;
            break;
          }

          if (iterationFailed) {
            const canProceed = await canProceedAfterIterationError(
              base,
              input,
              fetchImpl,
            );
            if (!canProceed) {
              yield {
                type: "error",
                layer: "orchestrator",
                code: "provider_or_model_unavailable",
                message:
                  "오류 발생 후 상태를 점검했지만 프로바이더 또는 모델이 준비되지 않아 벤치를 중단합니다.",
                partial: { scenarioId, api_route },
              };
              fatalStop = true;
              break;
            }
            i++;
            contentionRetries = 0;
            continue;
          }

          // 정상 완료: 다음 이터레이션으로.
          i++;
          contentionRetries = 0;
        }

        // 오염 재시도 한도 초과로 중단한 시나리오만 집계를 생략한다(불완전·신뢰불가).
        // 사전/이터레이션 간 대기 타임아웃은 그 이전에 깨끗이 완료된 런들의 집계를 유지한다.
        if (runs.length > 0 && contentionAbortReason !== "contention_max_retries_exceeded") {
          yield {
            type: "metrics_update",
            aggregate: {
              scenario_id: scenarioId,
              api_route,
              system_prompt: lastSystemPromptForAggregate,
              user_prompt: lastUserPromptForAggregate,
              runs,
            },
          };
        }
      }
    }

    // STEP 7: 단일 contention_summary 발행 지점(STEP 1 조기 return 경로 제외 모든 경로가 도달).
    if (contentionCfg.enabled) {
      yield {
        type: "contention_summary",
        total_iterations_discarded: totalDiscarded,
        max_pre_bench_wait_ms: maxPreWait,
        max_between_iteration_wait_ms: maxBetweenWait,
        total_wait_ms: waitAccum.total,
        guard_effective: guardEffective,
        gpu_signal_available: gpuSignalAvailable,
        abort_reason: contentionAbortReason,
      };
    }

    yield { type: "run_finished", run_id: rid };
  } finally {
    if (
      input.provider === "lm_studio" &&
      !input.skipModelLoad &&
      input.autoUnloadAfterBench &&
      modelLoadedByThisBench
    ) {
      const u = await lmStudioUnload(base, input.modelId, {
        fetchImpl,
        apiKey: input.apiKey,
      });
      yield {
        type: "model_unloaded",
        model_id: input.modelId,
        phase: "after_bench",
        ok: u.ok,
        status: u.status,
      };
    }
  }
}

function chunkTextForUi(text: string, size: number): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

const MEME_JUDGE_CRITERION =
  "Score the model's Korean explanation of this meme on 0–3:\n" +
  "3 = both panels' text quoted + correct visual description (server rack vs donkey cart) + identifies the irony of \"LLM cloud promises vs local PC reality\".\n" +
  "2 = correct OCR and visuals, but weak/missing technical framing (LLM/PC connection underexplained).\n" +
  "1 = describes the image but fails to explain why it is funny.\n" +
  "0 = OCR failure or irrelevant explanation.";

const WIREFRAME_JUDGE_CRITERION =
  "Score the generated HTML against the hand-drawn wireframe on 0–3:\n" +
  "3 = grid/flex used, all sections present at the right vertical order, every labeled element (buttons / nav items / form fields) reproduced.\n" +
  "2 = layout roughly matches but some alignment off, 1–2 minor text typos or one tiny component missing.\n" +
  "1 = collapses to a single column / fails multi-column layout, OR a key button (e.g. Sign Up / Get Started) or nav menu is missing.\n" +
  "0 = refuses to generate code / outputs unrelated code / barely any text from the wireframe.";

const JUDGE_CRITERIA: Partial<Record<ScenarioId, string>> = {
  vision_meme_explain_a: MEME_JUDGE_CRITERION,
  vision_meme_explain_b: MEME_JUDGE_CRITERION,
  vision_wireframe_html_a: WIREFRAME_JUDGE_CRITERION,
  vision_wireframe_html_b: WIREFRAME_JUDGE_CRITERION,
};

/**
 * #79/#83: 레지스트리 시나리오(agent_loop·커스텀)의 텍스트/산출물 judge.
 * 이미지 없이 최종 출력만 채점 — judge.ts의 일반화된 runLlmJudge(image 선택 + binary/0-3) 재사용.
 */
async function runJudgeForRegisteredScenario(
  def: import("@llm-bench/shared").ScenarioDef,
  output: string,
  fetchImpl: typeof fetch,
): Promise<{ pass: boolean; score: number; reason: string }> {
  const rubric = def.judge;
  if (!rubric) return { pass: true, score: 1, reason: "no judge rubric" };
  const result = await runLlmJudge({
    modelOutput: output,
    criterion: rubric.criterion,
    scale: rubric.scale,
    fetchImpl,
  });
  if (!result.enabled) return { pass: false, score: 0.33, reason: "judge disabled — prefilter only" };
  if ("error" in result) {
    return { pass: false, score: 0, reason: `${result.error}: ${result.reason}`.slice(0, 200) };
  }
  if (rubric.scale === "binary") {
    const pass = result.rubric >= 1;
    return { pass, score: pass ? 1 : 0, reason: `binary=${result.rubric} | judge: ${result.reason}` };
  }
  const rubric03 = Math.max(0, Math.min(3, Math.round(result.rubric))) as 0 | 1 | 2 | 3;
  const { pass, score } = rubricToScore(rubric03);
  return { pass, score, reason: `rubric=${rubric03} | judge: ${result.reason}` };
}

async function runJudgeForVisionScenario(
  scenarioId: ScenarioId,
  output: string,
  fetchImpl: typeof fetch,
): Promise<{ pass: boolean; score: number; reason: string }> {
  const criterion = JUDGE_CRITERIA[scenarioId];
  if (!criterion) {
    return { pass: false, score: 0, reason: "judge_skipped: no criterion" };
  }
  let asset;
  try {
    asset = loadVisionImageBytes(scenarioId);
  } catch (e) {
    return {
      pass: false,
      score: 0,
      reason: `judge_network_error: image load failed (${String(e).slice(0, 80)})`,
    };
  }
  const result = await runLlmJudge({
    image: { bytes: asset.bytes, mediaType: asset.mediaType },
    modelOutput: output,
    criterion,
    fetchImpl,
  });
  if (!result.enabled) {
    // Should not reach here because we check isJudgeEnabled() first.
    return { pass: false, score: 0.33, reason: "judge disabled — prefilter only" };
  }
  if ("error" in result) {
    return {
      pass: false,
      score: 0,
      reason: `${result.error}: ${result.reason}`.slice(0, 200),
    };
  }
  // 비전 저지는 0-3 스케일(judge.ts 기본). rubric은 이제 number 타입이라 0-3으로 클램프 캐스트.
  const rubric03 = Math.max(0, Math.min(3, Math.round(result.rubric))) as 0 | 1 | 2 | 3;
  const { pass, score } = rubricToScore(rubric03);
  return {
    pass,
    score,
    reason: `rubric=${rubric03} | judge: ${result.reason}`,
  };
}
