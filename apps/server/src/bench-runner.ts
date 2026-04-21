import type { BenchRunMeta, DetectResult, StreamEvent } from "@llm-bench/shared";
import { consumeAnthropicMessagesStream } from "./anthropic-stream.js";
import { consumeOpenAiChatStream, tpotFromOpenAi } from "./openai-stream.js";
import {
  ALL_SCENARIO_IDS,
  anthropicMessagesForScenario,
  buildMessages,
  scenarioUserMessageContent,
  scoreScenario,
  type ScenarioId,
} from "./scenarios.js";
import { lmStudioLoad, lmStudioUnload } from "./lmstudio.js";

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
  /** skip LM load/unload */
  skipModelLoad?: boolean;
  /** LM Studio: detect 목록에서 벤치 대상 외 모델 unload (베스트 에포트) */
  unloadOtherModels?: boolean;
};

function headers(apiKey?: string, extra?: Record<string, string>): HeadersInit {
  const h: Record<string, string> = { "content-type": "application/json", ...extra };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

function runId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** DB/SSE와 동일한 메타 스냅샷(런 ID만 외부에서 주입). */
export function makeBenchRunMeta(input: BenchRequest, detect: DetectResult, rid: string): BenchRunMeta {
  const base = detect.baseUrl.replace(/\/+$/, "");
  const scenarioIds =
    input.scenarioIds?.length && input.scenarioIds.every((s) => ALL_SCENARIO_IDS.includes(s as ScenarioId))
      ? input.scenarioIds
      : (ALL_SCENARIO_IDS as ScenarioId[]);
  const routes: ("chat_completions" | "messages")[] = [];
  if (detect.capabilities.openaiChat) routes.push("chat_completions");
  if (detect.capabilities.anthropicMessages) routes.push("messages");
  return {
    run_id: rid,
    app_version: "0.0.1",
    base_url: base,
    provider: input.provider,
    model_id: input.modelId,
    api_routes: routes,
    scenario_ids: scenarioIds,
    scenario_bundle_version: "1",
    temperature: input.temperature ?? 0.2,
    max_tokens: input.max_tokens ?? 512,
    seed: null,
    parallel: !!input.parallel,
    warmup_runs: input.warmupRuns ?? 1,
    measured_runs: input.measuredRuns ?? 3,
    unload_other_models: !!input.unloadOtherModels,
    created_at: new Date().toISOString(),
  };
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
  const meta = makeBenchRunMeta(input, detect, rid);

  yield { type: "run_started", run_id: rid, meta };

  if (!meta.api_routes.length) {
    yield {
      type: "error",
      layer: "orchestrator",
      code: "no_routes",
      message: "Neither /v1/chat/completions nor /v1/messages appears available for this base URL.",
    };
    return;
  }

  if (input.provider === "lm_studio" && !input.skipModelLoad && input.unloadOtherModels) {
    for (const m of detect.models) {
      if (m.id === input.modelId) continue;
      await lmStudioUnload(base, m.id, { fetchImpl, apiKey: input.apiKey });
    }
  }

  if (input.provider === "lm_studio" && !input.skipModelLoad) {
    await lmStudioUnload(base, input.modelId, { fetchImpl, apiKey: input.apiKey });
    const load = await lmStudioLoad(base, input.modelId, { fetchImpl, apiKey: input.apiKey });
    if (!load.ok) {
      yield {
        type: "error",
        layer: "orchestrator",
        code: "load_failed",
        message: `LM Studio load failed: ${load.status} ${load.body}`,
      };
      return;
    }
  }

  yield { type: "model_loaded", model_id: input.modelId, provider: input.provider };

  for (const api_route of meta.api_routes) {
    for (const scenarioId of meta.scenario_ids as ScenarioId[]) {
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
      for (let i = 0; i < totalIterations; i++) {
        const isWarmup = i < meta.warmup_runs;
        yield {
          type: "scenario_start",
          scenario_id: scenarioId,
          api_route,
          user_prompt: scenarioUserMessageContent(scenarioId),
        };

        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 120_000);

        try {
          let text = "";
          let ttft: number | null = null;
          let totalMs = 0;
          let streamCompleted = false;
          let tpot: number | null = null;

          if (api_route === "chat_completions") {
            const { messages, tools, tool_choice } = buildMessages(scenarioId);
            const body: Record<string, unknown> = {
              model: input.modelId,
              messages,
              temperature: meta.temperature,
              max_tokens: meta.max_tokens,
              stream: true,
            };
            if (tools) {
              body.tools = tools;
              body.tool_choice = tool_choice ?? "auto";
            }
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
              clearTimeout(to);
              return;
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
              clearTimeout(to);
              return;
            }
            const m = await consumeOpenAiChatStream(r.body, controller.signal);
            text = m.text;
            ttft = m.ttftMs;
            totalMs = m.totalMs;
            streamCompleted = m.streamCompleted;
            tpot = tpotFromOpenAi(m);
            for (const ch of chunkTextForUi(text, 24)) {
              yield { type: "token_delta", scenario_id: scenarioId, text: ch };
            }
          } else {
            const am = anthropicMessagesForScenario(scenarioId);
            const toolsAnthropic =
              scenarioId === "tool_weather"
                ? [
                    {
                      name: "get_weather",
                      description: "Get weather for a city",
                      input_schema: {
                        type: "object",
                        properties: { city: { type: "string" } },
                        required: ["city"],
                      },
                    },
                  ]
                : undefined;
            const body: Record<string, unknown> = {
              model: input.modelId,
              max_tokens: meta.max_tokens,
              temperature: meta.temperature,
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
              clearTimeout(to);
              return;
            }
            const m = await consumeAnthropicMessagesStream(r.body, controller.signal);
            text = m.text;
            ttft = m.ttftMs;
            totalMs = m.totalMs;
            streamCompleted = m.streamCompleted;
            tpot =
              ttft !== null && m.approxOutputTokens > 1
                ? (totalMs - ttft) / (m.approxOutputTokens - 1)
                : null;
            for (const ch of chunkTextForUi(text, 24)) {
              yield { type: "token_delta", scenario_id: scenarioId, text: ch };
            }
          }

          const quality = isWarmup ? undefined : scoreScenario(scenarioId, text);
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
          yield {
            type: "error",
            layer: "upstream",
            code: "aborted_or_error",
            message: String(e),
            partial: { scenarioId, api_route },
          };
          clearTimeout(to);
          return;
        } finally {
          clearTimeout(to);
        }
      }

      yield {
        type: "metrics_update",
        aggregate: {
          scenario_id: scenarioId,
          api_route,
          runs,
        },
      };
    }
  }

  yield { type: "run_finished", run_id: rid };
}

function chunkTextForUi(text: string, size: number): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}
