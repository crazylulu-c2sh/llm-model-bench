import type {
  BenchRunMeta,
  BenchTaskMode,
  DetectResult,
  StreamEvent,
  ThinkingIntent,
} from "@llm-bench/shared";
import { stripThinkingBlocks } from "@llm-bench/shared";
import { consumeAnthropicMessagesStream } from "./anthropic-stream.js";
import { consumeOpenAiChatStream, tpotFromOpenAi } from "./openai-stream.js";
import {
  ALL_SCENARIO_IDS,
  anthropicMessagesForScenario,
  anthropicToolsForScenario,
  buildMessages,
  isTranslateNistFips197PdfToolsScenario,
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
  const rawScenarioIds =
    input.scenarioIds?.length &&
    input.scenarioIds.every((s) => ALL_SCENARIO_IDS.includes(s as ScenarioId))
      ? input.scenarioIds
      : (ALL_SCENARIO_IDS as ScenarioId[]);
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
): {
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
} {
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
        for (let i = 0; i < totalIterations; i++) {
          const isWarmup = i < meta.warmup_runs;
          const ref = new Date();
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
          const userPromptThisRun = scenarioUserMessageContent(scenarioId, promptCtx);
          lastUserPromptForAggregate = userPromptThisRun;
          yield {
            type: "scenario_start",
            scenario_id: scenarioId,
            api_route,
            user_prompt: userPromptThisRun,
          };

          let iterationFailed = false;
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
                const r = await fetchImpl(`${base}/v1/chat/completions`, {
                  method: "POST",
                  headers: headers(input.apiKey),
                  body: JSON.stringify(body),
                  signal: controller.signal,
                });
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
                text = m.assistantText;
                break;
              }
              if (!iterationFailed) {
                totalMs = totalMsAcc;
                if (lastOpen) {
                  tpot = tpotFromOpenAi(lastOpen);
                  if (!text) text = lastOpen.assistantText;
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
              const r = await fetchImpl(`${base}/v1/chat/completions`, {
                method: "POST",
                headers: headers(input.apiKey),
                body: JSON.stringify(body),
                signal: controller.signal,
              });
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

            const quality = isWarmup
              ? undefined
              : scoreScenario(scenarioId, text, {
                  invokedBenchTools,
                  calendarReferenceIso: ref.toISOString(),
                  calendarTimeZone: "Asia/Seoul",
                });
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
            const code = isAbortLikeError(e)
              ? "request_timeout"
              : "upstream_exception";
            const message = isAbortLikeError(e)
              ? `요청이 ${Math.floor(requestTimeoutMs / 1000)}초 제한을 넘어 중단되었습니다 (${String(e)})`
              : String(e);
            yield {
              type: "error",
              layer: "upstream",
              code,
              message,
              partial: { scenarioId, api_route },
            };
            iterationFailed = true;
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
