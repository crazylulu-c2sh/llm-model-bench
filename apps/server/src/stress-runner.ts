import type {
  DetectResult,
  StressApiRoute,
  StressRampConfig,
  StressResolvedProfile,
  StressRunMeta,
  StressScriptMatch,
  StressStageLatencyMs,
  StressStageResult,
  StressStreamEvent,
  StressTpsSource,
  StressWorkloadId,
} from "@llm-bench/shared";
import {
  STRESS_WORKLOAD_IDS,
  approxOutputTokens,
  defaultMaxTokensForWorkload,
  expectedScriptForWorkload,
  getScenarioSystemPromptPreview,
  getScenarioUserPromptPreview,
  isStressWorkloadId,
  resolveBenchProfile,
  type LlmProfileFamily,
  type SamplingParams,
  type SamplingPresetName,
  type ThinkingIntent,
} from "@llm-bench/shared";
import { consumeAnthropicMessagesStream } from "./anthropic-stream.js";
import {
  consumeOpenAiChatStream,
  type OpenAiStreamDelta,
} from "./openai-stream.js";
import { openAiChatPostWithUsage } from "./openai-fetch.js";
import { detectScript } from "./scenarios.js";
import {
  lmStudioIsModelLoaded,
  lmStudioLoad,
  lmStudioUnload,
} from "./lmstudio.js";

export type StressRequest = {
  baseUrl: string;
  apiKey?: string;
  provider: DetectResult["provider"];
  modelId: string;
  workloadId: StressWorkloadId;
  ramp: StressRampConfig;
  maxTokens?: number;
  temperature?: number;
  workerPromptSuffix?: boolean;
  requestTimeoutMs?: number;
  skipModelLoad?: boolean;
  unloadOtherModels?: boolean;
  autoUnloadAfterBench?: boolean;
  /** 모델 벤치와 동일 profile 옵션 — `resolveBenchProfile`로 풀이 */
  profile?: {
    profileId?: LlmProfileFamily | "auto";
    taskMode?: "general" | "coding" | "tool";
    thinkingIntent?: ThinkingIntent;
    preserveThinking?: boolean;
    presetOverride?: SamplingPresetName;
    samplingOverrides?: SamplingParams;
    reasoningEffort?: "minimal" | "low" | "medium" | "high";
  };
};

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const MIN_REQUEST_TIMEOUT_MS = 5_000;
const MAX_REQUEST_TIMEOUT_MS = 600_000;

function clampRequestTimeoutMs(ms?: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_REQUEST_TIMEOUT_MS;
  const n = Math.floor(ms as number);
  if (n < MIN_REQUEST_TIMEOUT_MS) return MIN_REQUEST_TIMEOUT_MS;
  if (n > MAX_REQUEST_TIMEOUT_MS) return MAX_REQUEST_TIMEOUT_MS;
  return n;
}

function clampRamp(r: StressRampConfig): StressRampConfig {
  const start = Math.max(1, Math.min(256, Math.floor(r.start)));
  const max = Math.max(start, Math.min(256, Math.floor(r.max)));
  const step = Math.max(1, Math.min(64, Math.floor(r.step)));
  const durationMs = Math.max(100, Math.min(600_000, Math.floor(r.durationMs)));
  return { start, max, step, durationMs };
}

function runId(): string {
  return `stress_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function headers(apiKey?: string, extra?: Record<string, string>): HeadersInit {
  const h: Record<string, string> = {
    "content-type": "application/json",
    ...extra,
  };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

function pickRoute(detect: DetectResult): StressApiRoute | null {
  if (detect.capabilities.openaiChat) return "chat_completions";
  if (detect.capabilities.anthropicMessages) return "messages";
  return null;
}

function p50p95(values: number[]): StressStageLatencyMs {
  if (values.length === 0) return { p50: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number): number => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
    return sorted[idx];
  };
  return { p50: pick(0.5), p95: pick(0.95) };
}

function mergeTpsSources(sources: ("usage" | "approx")[]): StressTpsSource {
  if (sources.length === 0) return "approx";
  const usage = sources.filter((s) => s === "usage").length;
  if (usage === sources.length) return "usage";
  if (usage === 0) return "approx";
  return "mixed";
}

export function makeStressRunMeta(
  input: StressRequest,
  detect: DetectResult,
  rid: string,
  resolved: StressResolvedProfile | null,
): StressRunMeta {
  const route = pickRoute(detect);
  if (!route) {
    throw new Error("Neither /v1/chat/completions nor /v1/messages is available for this base URL.");
  }
  const ramp = clampRamp(input.ramp);
  const meta: StressRunMeta = {
    run_id: rid,
    app_version: "0.0.1",
    base_url: detect.baseUrl.replace(/\/+$/, ""),
    provider: input.provider,
    model_id: input.modelId,
    api_route: route,
    workload_id: input.workloadId,
    max_tokens: input.maxTokens ?? defaultMaxTokensForWorkload(input.workloadId),
    temperature: input.temperature ?? 0,
    ramp,
    request_timeout_ms: clampRequestTimeoutMs(input.requestTimeoutMs),
    worker_prompt_suffix: input.workerPromptSuffix ?? true,
    unload_other_models: input.unloadOtherModels ?? false,
    auto_unload_after_bench: input.autoUnloadAfterBench ?? false,
    skip_model_load: input.skipModelLoad ?? false,
    created_at: new Date().toISOString(),
  };
  if (resolved) {
    meta.profile_id = resolved.family;
    meta.profile_preset = resolved.preset;
    if (input.profile?.taskMode) meta.profile_task_mode = input.profile.taskMode;
    if (input.profile?.thinkingIntent) meta.profile_thinking_intent = input.profile.thinkingIntent;
    const effective: Record<string, number | undefined> = {};
    for (const [k, v] of Object.entries(resolved.sampling)) {
      if (typeof v === "number" && Number.isFinite(v)) effective[k] = v;
    }
    if (Object.keys(effective).length > 0) meta.effective_sampling = effective;
    if (resolved.extraBody && Object.keys(resolved.extraBody).length > 0) {
      meta.extra_body = { ...resolved.extraBody };
    }
    if (resolved.reasoningEffort) meta.reasoning_effort = resolved.reasoningEffort;
  }
  return meta;
}

function buildWorkloadMessages(
  workloadId: StressWorkloadId,
  workerIndex: number,
  workerPromptSuffix: boolean,
): { system: string; user: string } {
  const system = getScenarioSystemPromptPreview(workloadId);
  const stressWorkerIndex = workerPromptSuffix ? workerIndex + 1 : 0;
  const user = getScenarioUserPromptPreview(workloadId, { stressWorkerIndex });
  return { system, user };
}

function buildOpenAiBody(meta: StressRunMeta, messages: { role: string; content: string }[]): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: meta.model_id,
    messages,
    temperature: meta.temperature,
    max_tokens: meta.max_tokens,
    stream: true,
  };
  if (meta.effective_sampling) {
    for (const [k, v] of Object.entries(meta.effective_sampling)) {
      if (typeof v === "number" && Number.isFinite(v)) body[k] = v;
    }
  }
  if (meta.extra_body) {
    for (const [k, v] of Object.entries(meta.extra_body)) body[k] = v;
  }
  if (meta.reasoning_effort) {
    body.reasoning_effort = meta.reasoning_effort;
  }
  return body;
}

function buildAnthropicBody(
  meta: StressRunMeta,
  system: string,
  user: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: meta.model_id,
    max_tokens: meta.max_tokens,
    temperature: meta.temperature,
    system,
    messages: [{ role: "user", content: user }],
    stream: true,
  };
  if (meta.effective_sampling) {
    for (const [k, v] of Object.entries(meta.effective_sampling)) {
      if (typeof v === "number" && Number.isFinite(v) && (k === "top_p" || k === "top_k")) {
        body[k] = v;
      }
    }
  }
  return body;
}

type WorkerRequestOutcome = {
  ok: boolean;
  ttftMs: number | null;
  totalMs: number;
  outputText: string;
  outputTokens: number;
  tpsSource: "usage" | "approx";
  streamCompleted: boolean;
  errorCode?: string;
  errorMessage?: string;
  scriptMatch?: StressScriptMatch;
};

function uuid(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export type StressRunnerOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** stage_tick 주기 (ms). 기본 1000. */
  tickIntervalMs?: number;
  /** 테스트 결정성용: 한 워커가 한 단계에서 발사할 최대 요청 수. 미설정 시 무제한. */
  maxRequestsPerWorker?: number;
};

export async function* runStress(
  input: StressRequest,
  detect: DetectResult,
  opts: StressRunnerOptions = {},
): AsyncGenerator<StressStreamEvent> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tickIntervalMs = Math.max(250, opts.tickIntervalMs ?? 1000);
  const externalSignal = opts.signal;

  if (!isStressWorkloadId(input.workloadId)) {
    yield { type: "error", code: "invalid_workload", message: `unknown workload: ${input.workloadId}` };
    return;
  }
  if (!STRESS_WORKLOAD_IDS.includes(input.workloadId)) {
    yield { type: "error", code: "invalid_workload", message: `unknown workload: ${input.workloadId}` };
    return;
  }

  const rid = runId();
  const route = pickRoute(detect);
  if (!route) {
    yield {
      type: "error",
      code: "no_routes",
      message: "Neither /v1/chat/completions nor /v1/messages appears available for this base URL.",
    };
    return;
  }

  const resolved = input.profile
    ? resolveBenchProfile({
        modelId: input.modelId,
        taskMode: input.profile.taskMode ?? "general",
        thinkingIntent: input.profile.thinkingIntent ?? "on",
        preserveThinking: input.profile.preserveThinking,
        presetOverride: input.profile.presetOverride,
        samplingOverrides: input.profile.samplingOverrides,
        reasoningEffort: input.profile.reasoningEffort,
        profileFamilyOverride:
          input.profile.profileId && input.profile.profileId !== "auto"
            ? input.profile.profileId
            : null,
      })
    : null;

  const meta = makeStressRunMeta(input, detect, rid, resolved);
  const base = meta.base_url;

  yield { type: "run_started", run_id: rid, meta };

  // LM Studio: 다른 모델 unload + 대상 load (bench-runner와 동일 정책)
  let modelLoadedByThisRun = false;
  if (input.provider === "lm_studio" && !meta.skip_model_load && meta.unload_other_models) {
    for (const m of detect.models) {
      if (m.id === input.modelId) continue;
      await lmStudioUnload(base, m.id, { fetchImpl, apiKey: input.apiKey });
    }
  }
  let lmStudioPrepare: "loaded" | "already_in_memory" | "load_skipped_by_request" | undefined;
  if (input.provider === "lm_studio") {
    if (meta.skip_model_load) {
      lmStudioPrepare = "load_skipped_by_request";
    } else {
      const loaded = await lmStudioIsModelLoaded(base, input.modelId, {
        fetchImpl,
        apiKey: input.apiKey,
      });
      if (loaded.ok && loaded.loaded) {
        lmStudioPrepare = "already_in_memory";
      } else {
        await lmStudioUnload(base, input.modelId, { fetchImpl, apiKey: input.apiKey });
        const load = await lmStudioLoad(base, input.modelId, { fetchImpl, apiKey: input.apiKey });
        if (!load.ok) {
          yield {
            type: "error",
            code: "load_failed",
            message: `LM Studio load failed: ${load.status} ${load.body}`,
          };
          return;
        }
        lmStudioPrepare = "loaded";
        modelLoadedByThisRun = true;
      }
    }
  }
  yield { type: "model_loaded", model_id: input.modelId, ...(lmStudioPrepare ? { lm_studio_prepare: lmStudioPrepare } : {}) };

  const expectedScript = expectedScriptForWorkload(meta.workload_id);

  const stages: StressStageResult[] = [];

  try {
    let stageIndex = 0;
    for (let cc = meta.ramp.start; cc <= meta.ramp.max; cc += meta.ramp.step) {
      if (externalSignal?.aborted) {
        yield { type: "error", code: "aborted", message: "aborted by user" };
        break;
      }
      const concurrency = cc;

      yield {
        type: "stress_stage_started",
        stage_index: stageIndex,
        concurrency,
        workload_id: meta.workload_id,
      };

      const stageStart = performance.now();
      const enqueueDeadline = stageStart + meta.ramp.durationMs;

      // 이벤트 큐 + 백프레셔 — 워커가 ev를 push하면 outer loop가 yield.
      // queue가 일정 크기 이상이면 producer는 await drain하여 메모리를 보호.
      const queue: StressStreamEvent[] = [];
      const QUEUE_HIGH_WATER = 256;
      let resolveWait: (() => void) | null = null;
      let resolveDrain: (() => void) | null = null;
      const wake = () => {
        const r = resolveWait;
        resolveWait = null;
        if (r) r();
      };
      const drainSignal = () => {
        const r = resolveDrain;
        resolveDrain = null;
        if (r) r();
      };
      const pushEvent = (ev: StressStreamEvent) => {
        queue.push(ev);
        wake();
      };
      const awaitDrainIfFull = async (): Promise<void> => {
        if (queue.length < QUEUE_HIGH_WATER) return;
        await new Promise<void>((resolve) => {
          resolveDrain = resolve;
        });
      };

      const requestOutcomes: WorkerRequestOutcome[] = [];
      let lastTickAt = performance.now();
      let succeededSoFar = 0;
      let totalOutputTokensSoFar = 0;

      const tickInterval = setInterval(() => {
        const now = performance.now();
        const elapsed = (now - stageStart) / 1000;
        const tpsSnapshot = elapsed > 0 ? totalOutputTokensSoFar / elapsed : null;
        pushEvent({
          type: "stress_stage_tick",
          stage_index: stageIndex,
          concurrency,
          aggregate_tps_so_far: tpsSnapshot != null && tpsSnapshot >= 0 ? tpsSnapshot : null,
          succeeded_so_far: succeededSoFar,
        });
        lastTickAt = now;
      }, tickIntervalMs);
      void lastTickAt;

      const workerPromises: Promise<void>[] = [];
      for (let workerIndex = 0; workerIndex < concurrency; workerIndex++) {
        const wi = workerIndex;
        const maxRequests = opts.maxRequestsPerWorker;
        workerPromises.push(
          (async () => {
            let requestsIssued = 0;
            while (true) {
              if (externalSignal?.aborted) return;
              if (performance.now() >= enqueueDeadline) return;
              if (maxRequests != null && requestsIssued >= maxRequests) return;
              await awaitDrainIfFull();
              if (externalSignal?.aborted) return;
              if (performance.now() >= enqueueDeadline) return;
              requestsIssued += 1;

              const requestId = uuid();
              const { system, user } = buildWorkloadMessages(meta.workload_id, wi, meta.worker_prompt_suffix);
              pushEvent({
                type: "stress_worker_request_start",
                stage_index: stageIndex,
                worker_index: wi,
                request_id: requestId,
                user_prompt: user,
                system_prompt: system,
              });

              const reqController = new AbortController();
              const timeout = setTimeout(() => reqController.abort(), meta.request_timeout_ms);
              const onAbort = () => reqController.abort();
              if (externalSignal) externalSignal.addEventListener("abort", onAbort);

              const outcome: WorkerRequestOutcome = {
                ok: false,
                ttftMs: null,
                totalMs: 0,
                outputText: "",
                outputTokens: 0,
                tpsSource: "approx",
                streamCompleted: false,
              };
              try {
                if (route === "chat_completions") {
                  const body = buildOpenAiBody(meta, [
                    { role: "system", content: system },
                    { role: "user", content: user },
                  ]);
                  const { response } = await openAiChatPostWithUsage(
                    fetchImpl,
                    `${base}/v1/chat/completions`,
                    base,
                    headers(input.apiKey),
                    body,
                    reqController.signal,
                  );
                  if (!response.ok || !response.body) {
                    outcome.errorCode = String(response.status);
                    outcome.errorMessage = (await response.text().catch(() => "")).slice(0, 500);
                  } else {
                    const m = await consumeOpenAiChatStream(response.body, reqController.signal, {
                      onDelta: (d: OpenAiStreamDelta) => {
                        pushEvent({
                          type: "stress_worker_token_delta",
                          stage_index: stageIndex,
                          worker_index: wi,
                          request_id: requestId,
                          text: d.text,
                          ...(d.kind === "reasoning" ? { reasoning: true } : {}),
                        });
                      },
                    });
                    outcome.ttftMs = m.ttftMs;
                    outcome.totalMs = m.totalMs;
                    outcome.outputText = m.assistantText;
                    outcome.streamCompleted = m.streamCompleted;
                    if (typeof m.usageOutputTokens === "number" && m.usageOutputTokens > 0) {
                      outcome.outputTokens = m.usageOutputTokens;
                      outcome.tpsSource = "usage";
                    } else {
                      outcome.outputTokens = approxOutputTokens(m.assistantText);
                      outcome.tpsSource = "approx";
                    }
                    outcome.ok =
                      (m.streamCompleted || m.assistantText.trim().length > 0) &&
                      outcome.outputTokens > 0;
                  }
                } else {
                  const body = buildAnthropicBody(meta, system, user);
                  const response = await fetchImpl(`${base}/v1/messages`, {
                    method: "POST",
                    headers: headers(input.apiKey, { "anthropic-version": "2023-06-01" }),
                    body: JSON.stringify(body),
                    signal: reqController.signal,
                  });
                  if (!response.ok || !response.body) {
                    outcome.errorCode = String(response.status);
                    outcome.errorMessage = (await response.text().catch(() => "")).slice(0, 500);
                  } else {
                    const m = await consumeAnthropicMessagesStream(response.body, reqController.signal, {
                      onDelta: (d) => {
                        pushEvent({
                          type: "stress_worker_token_delta",
                          stage_index: stageIndex,
                          worker_index: wi,
                          request_id: requestId,
                          text: d.text,
                        });
                      },
                    });
                    outcome.ttftMs = m.ttftMs;
                    outcome.totalMs = m.totalMs;
                    outcome.outputText = m.assistantText;
                    outcome.streamCompleted = m.streamCompleted;
                    if (typeof m.usageOutputTokens === "number" && m.usageOutputTokens > 0) {
                      outcome.outputTokens = m.usageOutputTokens;
                      outcome.tpsSource = "usage";
                    } else {
                      outcome.outputTokens = approxOutputTokens(m.assistantText);
                      outcome.tpsSource = "approx";
                    }
                    outcome.ok =
                      (m.streamCompleted || m.assistantText.trim().length > 0) &&
                      outcome.outputTokens > 0;
                  }
                }
              } catch (e) {
                const err = e as { name?: string; message?: string };
                outcome.errorCode = err?.name === "AbortError" ? "request_aborted" : "upstream_exception";
                outcome.errorMessage = String(e);
              } finally {
                clearTimeout(timeout);
                if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
              }

              if (outcome.ok && (expectedScript === "ko" || expectedScript === "ja")) {
                outcome.scriptMatch = detectScript(outcome.outputText);
              } else if (outcome.ok) {
                outcome.scriptMatch = detectScript(outcome.outputText);
              }

              requestOutcomes.push(outcome);
              if (outcome.ok) {
                succeededSoFar++;
                totalOutputTokensSoFar += outcome.outputTokens;
              }
              pushEvent({
                type: "stress_worker_request_end",
                stage_index: stageIndex,
                worker_index: wi,
                request_id: requestId,
                ok: outcome.ok,
                ttft_ms: outcome.ttftMs,
                total_ms: outcome.totalMs,
                output_chars: outcome.outputText.length,
                output_tokens: outcome.outputTokens,
                tps_source: outcome.tpsSource,
                stream_completed: outcome.streamCompleted,
                ...(outcome.scriptMatch ? { script_match: outcome.scriptMatch } : {}),
                ...(outcome.errorCode ? { error_code: outcome.errorCode } : {}),
                ...(outcome.errorMessage ? { error_message: outcome.errorMessage } : {}),
              });

              if (!outcome.ok && (outcome.errorCode === "401" || outcome.errorCode === "403")) {
                return;
              }
            }
          })(),
        );
      }

      // Producer가 끝날 때까지 outer loop가 큐에서 이벤트를 yield
      const allDone = (async () => {
        await Promise.all(workerPromises);
      })();

      let producerFinished = false;
      allDone.then(() => {
        producerFinished = true;
        wake();
      });

      while (true) {
        if (queue.length === 0) {
          if (producerFinished) break;
          await new Promise<void>((resolve) => {
            resolveWait = resolve;
            // Race guard: producer may have set producerFinished or pushed
            // between our checks above and now. Re-check inside executor.
            if (producerFinished || queue.length > 0) {
              resolveWait = null;
              resolve();
            }
          });
          continue;
        }
        const ev = queue.shift();
        // producer 백프레셔 해제: 큐가 절반 이하로 줄면 깨움.
        if (queue.length < QUEUE_HIGH_WATER / 2) drainSignal();
        if (ev) yield ev;
      }
      clearInterval(tickInterval);

      const stageEnd = performance.now();
      const drainStart = enqueueDeadline > stageStart ? enqueueDeadline : stageStart;
      const enqueueDurationMs = Math.max(0, drainStart - stageStart);
      const drainMs = Math.max(0, stageEnd - drainStart);
      const durationMs = stageEnd - stageStart;
      const successful = requestOutcomes.filter((r) => r.ok);
      const failedCount = requestOutcomes.length - successful.length;
      const outputTokensTotal = successful.reduce((sum, r) => sum + r.outputTokens, 0);
      const latencies = successful.map((r) => r.totalMs);
      const latency = p50p95(latencies);
      const elapsedSec = durationMs / 1000;
      const aggregateTpsRaw = elapsedSec > 0 ? outputTokensTotal / elapsedSec : null;
      const tooFew = successful.length < 5;
      const tooShort = durationMs < 3000;
      const noSuccess = successful.length === 0;
      const tpsUnreliable = noSuccess || tooShort || tooFew;
      const aggregateTps = tpsUnreliable ? null : aggregateTpsRaw;
      const tpsPerUser = aggregateTps != null ? aggregateTps / concurrency : null;
      const tpsSource = mergeTpsSources(successful.map((r) => r.tpsSource));
      let scriptMatchRate: number | null = null;
      if (expectedScript !== "latin") {
        const matched = successful.filter((r) => r.scriptMatch === expectedScript).length;
        scriptMatchRate = successful.length > 0 ? matched / successful.length : null;
      }
      const result: StressStageResult = {
        stage_index: stageIndex,
        concurrency,
        duration_ms: Math.round(durationMs),
        enqueue_duration_ms: Math.round(enqueueDurationMs),
        drain_ms: Math.round(drainMs),
        requests_attempted: requestOutcomes.length,
        requests_succeeded: successful.length,
        output_tokens_total: outputTokensTotal,
        aggregate_tps: aggregateTps != null ? Number(aggregateTps.toFixed(3)) : null,
        tps_per_user: tpsPerUser != null ? Number(tpsPerUser.toFixed(3)) : null,
        ...(tpsUnreliable ? { tps_unreliable: true as const } : {}),
        latency_ms: {
          p50: latency.p50 != null ? Math.round(latency.p50) : null,
          p95: latency.p95 != null ? Math.round(latency.p95) : null,
        },
        error_rate: requestOutcomes.length > 0 ? failedCount / requestOutcomes.length : 0,
        tps_source: tpsSource,
        ...(scriptMatchRate != null ? { script_match_rate: Number(scriptMatchRate.toFixed(3)) } : {}),
      };
      stages.push(result);
      yield { type: "stress_stage_finished", stage_index: stageIndex, result };

      stageIndex++;
      if (externalSignal?.aborted) break;
    }

    yield { type: "run_finished", run_id: rid, stages };
  } finally {
    if (
      input.provider === "lm_studio" &&
      !meta.skip_model_load &&
      meta.auto_unload_after_bench &&
      modelLoadedByThisRun
    ) {
      const u = await lmStudioUnload(base, input.modelId, { fetchImpl, apiKey: input.apiKey });
      yield { type: "model_unloaded", model_id: input.modelId, phase: "after_bench", ok: u.ok, status: u.status };
    }
  }
}
