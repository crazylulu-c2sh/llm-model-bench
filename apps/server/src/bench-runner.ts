import type {
  BenchRunMeta,
  BenchTaskMode,
  DetectResult,
  StreamEvent,
  ThinkingIntent,
} from "@llm-bench/shared";
import {
  DEFAULT_SCENARIO_IDS,
  PUBLIC_SCENARIO_IDS,
  defaultMaxTokensForVisionScenario,
  isVisionScenario,
  rubricToScore,
  stripThinkingBlocks,
} from "@llm-bench/shared";
import { isJudgeEnabled, runLlmJudge } from "./judge.js";
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
  tpotFromOpenAi,
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
import {
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
  /** default false — if true, UI must warn */
  parallel?: boolean;
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
  /** Vite `public/` 베이스 URL (예: window.location.origin) — nist.fips.197.pdf 툴 fetch 허용 */
  publicAssetsOrigin?: string;
  /** 모델 카드 기반 샘플링/사고 모드 프로파일 */
  profile?: BenchProfileRequestFields;
  /** 프로파일 전용 max_tokens (UI). 일반 `max_tokens`와 분리해 시나리오별 권장값과 충돌하지 않게 함 */
  profileMaxTokens?: number;
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

/** PDF·툴 시나리오를 항상 마지막에 두어 나머지 시나리오를 먼저 실행한다. */
export function normalizeScenarioIdsForBench(ids: ScenarioId[]): ScenarioId[] {
  const translate: ScenarioId = "translate_nist_fips197_pdf_tools";
  const hasTranslate = ids.includes(translate);
  const rest = ids.filter((id) => id !== translate);
  return hasTranslate ? [...rest, translate] : rest;
}

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
        (s): s is ScenarioId =>
          (PUBLIC_SCENARIO_IDS as readonly string[]).includes(s) &&
          (ALL_SCENARIO_IDS as readonly string[]).includes(s),
      )
    : null;
  const rawScenarioIds: ScenarioId[] =
    userScenarioIds && userScenarioIds.length > 0
      ? userScenarioIds
      : (DEFAULT_SCENARIO_IDS as ScenarioId[]);
  const scenarioIds = normalizeScenarioIdsForBench(rawScenarioIds);
  const routes: ("chat_completions" | "messages")[] = [];
  if (detect.capabilities.openaiChat) routes.push("chat_completions");
  if (detect.capabilities.anthropicMessages) routes.push("messages");
  const baseMeta: BenchRunMeta = {
    run_id: rid,
    app_version: "0.0.1",
    base_url: base,
    provider: input.provider,
    model_id: input.modelId,
    api_routes: routes,
    scenario_ids: scenarioIds,
    scenario_bundle_version: "4",
    temperature: input.temperature ?? 0.2,
    max_tokens: input.max_tokens ?? 512,
    seed: null,
    parallel: !!input.parallel,
    warmup_runs: input.warmupRuns ?? 1,
    measured_runs: input.measuredRuns ?? 3,
    unload_other_models: !!input.unloadOtherModels,
    auto_unload_after_bench: !!input.autoUnloadAfterBench,
    public_assets_origin: resolvePublicAssetsOrigin(input),
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
  opts: { fetchImpl?: typeof fetch } = {},
): AsyncGenerator<StreamEvent> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = detect.baseUrl.replace(/\/+$/, "");
  const serial = input.serial !== false;
  if (!serial && input.parallel) {
    /* parallel batching left minimal: still sequential model loop in v1 */
  }

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

  if (
    input.provider === "lm_studio" &&
    !input.skipModelLoad &&
    input.unloadOtherModels
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
          tpot_ms: number | null;
          total_ms: number;
          output_text: string;
          stream_completed: boolean;
          quality?: { pass: boolean; score?: number; reason?: string };
        }[] = [];

        const totalIterations = meta.warmup_runs + meta.measured_runs;
        /** 집계 `runs`의 마지막 측정 런과 동일한 참조를 쓴 user 프롬프트 스냅샷 */
        let lastUserPromptForAggregate = "";
        /** 집계 `runs`의 마지막 측정 런과 동일한 system 프롬프트 스냅샷 */
        let lastSystemPromptForAggregate = "";
        for (let i = 0; i < totalIterations; i++) {
          const isWarmup = i < meta.warmup_runs;
          const ref = new Date();
          const visionThisRun = isVisionScenario(scenarioId);

          // D7: 비전 시나리오는 warmup 단계에서 호출하지 않는다 — 이미지
          // 인코딩·멀티모달 API 비용을 warmup에서 중복시키지 않음.
          if (isWarmup && visionThisRun) {
            continue;
          }

          const promptCtx = {
            publicAssetsOrigin: assetOrigin,
            referenceAt: ref,
            calendarTimeZone: "Asia/Seoul",
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
          const controller = new AbortController();
          const to = setTimeout(() => controller.abort(), requestTimeoutMs);

          try {
            let text = "";
            let ttft: number | null = null;
            let totalMs = 0;
            let streamCompleted = false;
            let tpot: number | null = null;
            const invokedBenchTools: string[] = [];

            if (
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
                const { response: r } = await openAiChatPostWithUsage(
                  fetchImpl,
                  `${base}/v1/chat/completions`,
                  base,
                  headers(input.apiKey),
                  body,
                  controller.signal,
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
                  controller.signal,
                );
                lastOpen = m;
                if (m.finishReason === "length") truncated = true;
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
                  tpot = tpotFromOpenAi(lastOpen);
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
                const r = await fetchImpl(`${base}/v1/messages`, {
                  method: "POST",
                  headers: headers(input.apiKey, {
                    "anthropic-version": "2023-06-01",
                  }),
                  body: JSON.stringify(body),
                  signal: controller.signal,
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
                  controller.signal,
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
                text = m.assistantText;
                break;
              }
              if (!iterationFailed) {
                totalMs = totalMsAcc;
                if (lastAnth) {
                  tpot =
                    lastAnth.ttftMs !== null && lastAnth.approxOutputTokens > 1
                      ? (lastAnth.totalMs - lastAnth.ttftMs) /
                        (lastAnth.approxOutputTokens - 1)
                      : null;
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
              const { response: r } = await openAiChatPostWithUsage(
                fetchImpl,
                `${base}/v1/chat/completions`,
                base,
                headers(input.apiKey),
                body,
                controller.signal,
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
                  controller.signal,
                );
                text = m.text;
                ttft = m.ttftMs;
                totalMs = m.totalMs;
                streamCompleted = m.streamCompleted;
                if (m.finishReason === "length") truncated = true;
                tpot = tpotFromOpenAi(m);
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

              const r = await fetchImpl(`${base}/v1/messages`, {
                method: "POST",
                headers: headers(input.apiKey, {
                  "anthropic-version": "2023-06-01",
                }),
                body: JSON.stringify(body),
                signal: controller.signal,
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
                  controller.signal,
                );
                text = m.text;
                ttft = m.ttftMs;
                totalMs = m.totalMs;
                streamCompleted = m.streamCompleted;
                if (m.stopReason === "max_tokens") truncated = true;
                tpot =
                  ttft !== null && m.approxOutputTokens > 1
                    ? (totalMs - ttft) / (m.approxOutputTokens - 1)
                    : null;
                for (const ch of chunkTextForUi(text, 24)) {
                  yield {
                    type: "token_delta",
                    scenario_id: scenarioId,
                    text: ch,
                  };
                }
              }
            }

            let quality:
              | { pass: boolean; score?: number; reason?: string; judge_pending?: true }
              | undefined = isWarmup
              ? undefined
              : scoreScenario(scenarioId, text, {
                  invokedBenchTools,
                  calendarReferenceIso: ref.toISOString(),
                  calendarTimeZone: "Asia/Seoul",
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
              quality = await runJudgeForVisionScenario(scenarioId, text, fetchImpl);
            }
            // emit 직전 내부 플래그 제거 — SSE/DB에는 노출되지 않게 한다.
            if (quality && quality.judge_pending === true) {
              const { judge_pending: _drop, ...rest } = quality;
              void _drop;
              quality = rest;
            }
            // C-3: max_tokens 잘림이 발생한 경우 quality.reason에 prefix 추가.
            // `upstream_no_vision`은 이미 quality 전체를 교체했으므로 prefix 미적용.
            // `image_too_large`는 try/catch 분기에서 별도 emit 경로라 이 코드를 거치지 않음.
            if (!isWarmup && quality && truncated && !upstreamNoVisionDetail) {
              const tokens = scenarioMeta.max_tokens;
              const prevReason = quality.reason ?? "";
              quality = {
                ...quality,
                reason: prevReason
                  ? `truncated_at_max_tokens=${tokens} | ${prevReason}`
                  : `truncated_at_max_tokens=${tokens}`,
              };
            }
            if (!isWarmup) {
              runs.push({
                ttft_ms: ttft,
                tpot_ms: tpot,
                total_ms: totalMs,
                output_text: text,
                stream_completed: streamCompleted,
                quality,
              });
            }

            yield {
              type: "scenario_end",
              scenario_id: scenarioId,
              api_route,
              metrics: {
                ttft_ms: ttft,
                tpot_ms: tpot,
                total_ms: totalMs,
                output_chars: text.length,
                approx_tokens: Math.ceil(text.length / 4),
                stream_completed: streamCompleted,
              },
              quality,
            };
          } catch (e) {
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
                tpot_ms: null,
                total_ms: 0,
                output_text: "",
                stream_completed: false,
                quality,
              });
              yield {
                type: "scenario_end",
                scenario_id: scenarioId,
                api_route,
                metrics: {
                  ttft_ms: null,
                  tpot_ms: null,
                  total_ms: 0,
                  output_chars: 0,
                  approx_tokens: 0,
                  stream_completed: false,
                },
                quality,
              };
            }
          } finally {
            clearTimeout(to);
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
            continue;
          }
        }

        if (runs.length > 0) {
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
  const { pass, score } = rubricToScore(result.rubric);
  return {
    pass,
    score,
    reason: `rubric=${result.rubric} | judge: ${result.reason}`,
  };
}
