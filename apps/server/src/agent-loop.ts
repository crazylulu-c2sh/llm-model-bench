import type { AgentLoop, BenchRunMeta, MockTool, ScenarioDef, StreamEvent } from "@llm-bench/shared";
import { runtimeToolsToAnthropic, runtimeToolsToOpenAi, stripThinkingBlocks } from "@llm-bench/shared";
import { openAiChatPostWithUsage } from "./openai-fetch.js";
import { consumeOpenAiChatStream } from "./openai-stream.js";
import { consumeAnthropicMessagesStream } from "./anthropic-stream.js";
import { anthropicExtrasFromMeta, openAiExtrasFromMeta } from "./profile.js";

/**
 * #79: 멀티턴 agent_loop mock-tool 하네스.
 *
 * 실제 도구를 실행하지 않고(캔드 결과만 되먹임) N턴을 구동해, 단일-샷 function-calling이 못 잡는
 * 결함(빈-턴 정체 · 중간 턴 사고 누수)을 턴을 가로질러 드러낸다. chat_completions·messages 두 라우트.
 */

export type AgentLoopMetrics = {
  /** 완료까지 걸린 턴 수(정체/예산소진이면 null). */
  turns_to_completion: number | null;
  /** content=="" && tool_calls==0 인 빈 턴 수. */
  empty_turn_count: number;
  /** 유효 tool_call(선언된 도구명 + JSON-파싱 가능 인자)을 낸 턴 비율(0~1). */
  valid_tool_call_rate: number;
  /** 중간(비최종) 턴 content에 사고/채널 태그가 누수됐는지. */
  intermediate_turn_leak: boolean;
  completion_reason: "completed" | "stall" | "budget_exhausted";
};

export type AgentLoopResult = {
  /** 채점/저장용 최종 출력(추론 포함 combined). */
  text: string;
  /** 채점용 가시 최종 content(추론 제거). */
  scoreText: string;
  ttft: number | null;
  totalMs: number;
  streamCompleted: boolean;
  usageOutputTokens: number | null;
  reasoningChars: number;
  toolArgsCorruptedAny: boolean;
  metrics: AgentLoopMetrics;
};

/** 라우트-중립 턴 결과(하네스 공용 분석 입력). */
type NormalizedTurn = {
  content: string; // 가시 assistant content(추론 제외)
  reasoningText: string;
  toolCalls: Array<{ id: string; name: string; argsJson: string }>;
  usageOutputTokens: number | null;
  ttftMs: number | null;
  totalMs: number;
  streamCompleted: boolean;
  toolArgsCorrupted: boolean;
  combinedText: string; // 추론+content(+toolJSON) — output_text 기준
};

type LoopState = {
  turnsExecuted: number;
  emptyTurnCount: number;
  validToolTurns: number;
  intermediateLeak: boolean;
  ttft: number | null;
  totalMs: number;
  usageOutputTokens: number | null;
  reasoningChars: number;
  toolArgsCorruptedAny: boolean;
  streamCompleted: boolean;
  lastVisible: string;
  lastCombined: string;
};

type StepDecision =
  | { kind: "tools"; toolResults: Array<{ id: string; name: string; result: string }> }
  | {
      kind: "final";
      reason: "completed" | "stall";
      turnsToCompletion: number | null;
      visible: string;
      combined: string;
    };

function jsonParses(s: string): boolean {
  try {
    JSON.parse(s || "{}");
    return true;
  } catch {
    return false;
  }
}

/** 도구명에 매칭되는 mock 큐에서 다음 캔드 응답을 뽑는다(소진 시 repeatLast 또는 에러). */
function pullMock(mockTools: readonly MockTool[], toolName: string, cursor: Map<string, number>): string {
  const mt = mockTools.find((m) => m.tool === toolName);
  if (!mt) return JSON.stringify({ error: `no mock configured for tool ${toolName}` });
  const i = cursor.get(toolName) ?? 0;
  cursor.set(toolName, i + 1);
  if (i < mt.responses.length) return mt.responses[i]!;
  if (mt.repeatLast) return mt.responses[mt.responses.length - 1]!;
  return JSON.stringify({ error: "mock responses exhausted" });
}

/** 한 턴 결과를 분석해 상태를 누적하고 다음 동작(도구 라운드 계속 / 최종)을 결정한다(라우트 공용, 순수). */
function stepAgentLoop(
  turn: NormalizedTurn,
  def: ScenarioDef,
  loop: AgentLoop,
  state: LoopState,
  cursor: Map<string, number>,
): StepDecision {
  state.turnsExecuted += 1;
  if (state.turnsExecuted === 1) state.ttft = turn.ttftMs;
  state.totalMs += turn.totalMs;
  if (turn.usageOutputTokens != null) {
    state.usageOutputTokens = (state.usageOutputTokens ?? 0) + turn.usageOutputTokens;
  }
  // 전 턴 누적. usageOutputTokens(전 턴 누적)와 분모/분자를 정합시켜야 thinking_leak_ratio
  // (scoreboard: reasoning_chars→토큰 추정 / 총 usage 토큰)가 멀티턴 agent_loop 에서 정확해진다.
  // 이전엔 마지막 턴만 반영 → 무거운 합성 턴 뒤에 가벼운 최종 요약 턴이 오면 사고 누수가 과소계상됐다.
  state.reasoningChars += turn.reasoningText.length;
  if (turn.toolArgsCorrupted) state.toolArgsCorruptedAny = true;
  state.streamCompleted = turn.streamCompleted;

  const declared = new Set(def.tools.map((t) => t.name));
  const validCall = turn.toolCalls.some((tc) => declared.has(tc.name) && jsonParses(tc.argsJson));
  if (validCall) state.validToolTurns += 1;

  const visible = stripThinkingBlocks(turn.content);
  const hasTools = turn.toolCalls.length > 0;
  const isEmpty = visible.trim() === "" && !hasTools;
  if (isEmpty) state.emptyTurnCount += 1;

  state.lastVisible = visible;
  state.lastCombined = turn.combinedText;

  if (hasTools) {
    // 중간 턴 — content에 사고/채널 태그 누수 검사.
    if (turn.content && stripThinkingBlocks(turn.content) !== turn.content.trim()) {
      state.intermediateLeak = true;
    }
    const toolResults = turn.toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      result: pullMock(loop.mockTools, tc.name, cursor),
    }));
    return { kind: "tools", toolResults };
  }

  // 도구 호출 없음 → 최종 턴. 빈 content면 정체(empty_turn_loop:no_signal), 아니면 완료.
  if (isEmpty) {
    return { kind: "final", reason: "stall", turnsToCompletion: null, visible, combined: turn.combinedText };
  }
  return {
    kind: "final",
    reason: "completed",
    turnsToCompletion: state.turnsExecuted,
    visible,
    combined: turn.combinedText,
  };
}

function initState(): LoopState {
  return {
    turnsExecuted: 0,
    emptyTurnCount: 0,
    validToolTurns: 0,
    intermediateLeak: false,
    ttft: null,
    totalMs: 0,
    usageOutputTokens: null,
    reasoningChars: 0,
    toolArgsCorruptedAny: false,
    streamCompleted: false,
    lastVisible: "",
    lastCombined: "",
  };
}

function finalize(
  state: LoopState,
  reason: AgentLoopMetrics["completion_reason"],
  turnsToCompletion: number | null,
  scoreText: string,
  text: string,
): AgentLoopResult {
  return {
    text,
    scoreText,
    ttft: state.ttft,
    totalMs: state.totalMs,
    streamCompleted: state.streamCompleted,
    usageOutputTokens: state.usageOutputTokens,
    reasoningChars: state.reasoningChars,
    toolArgsCorruptedAny: state.toolArgsCorruptedAny,
    metrics: {
      turns_to_completion: turnsToCompletion,
      empty_turn_count: state.emptyTurnCount,
      valid_tool_call_rate: state.turnsExecuted > 0 ? state.validToolTurns / state.turnsExecuted : 0,
      intermediate_turn_leak: state.intermediateLeak,
      completion_reason: reason,
    },
  };
}

function chunk(text: string, size = 24): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function headers(apiKey?: string, extra?: Record<string, string>): HeadersInit {
  const h: Record<string, string> = { "content-type": "application/json", ...extra };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

export type AgentLoopArgs = {
  base: string;
  apiKey?: string;
  model: string;
  def: ScenarioDef;
  meta: BenchRunMeta;
  scenarioId: string;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  requestStartedAt?: number;
  /** def.sampling가 없을 때 폴백 max_tokens/temperature. */
  maxTokens: number;
  temperature: number;
};

// ─── OpenAI chat_completions 하네스 ────────────────────────────────────────────
type OpenAiMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

export async function* runAgentLoopOpenAi(
  args: AgentLoopArgs,
): AsyncGenerator<StreamEvent, AgentLoopResult> {
  const { base, apiKey, model, def, meta, scenarioId, fetchImpl, signal } = args;
  const loop = def.agentLoop!;
  const tools = runtimeToolsToOpenAi(def.tools);
  const messages: OpenAiMsg[] = [
    { role: "system", content: def.system },
    { role: "user", content: def.user },
  ];
  const state = initState();
  const cursor = new Map<string, number>();

  for (let t = 0; t < loop.maxTurns; t++) {
    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      temperature: def.sampling?.temperature ?? args.temperature,
      max_tokens: def.sampling?.max_tokens ?? args.maxTokens,
      ...(def.sampling?.top_p != null ? { top_p: def.sampling.top_p } : {}),
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
      ...openAiExtrasFromMeta(meta),
    };
    const { response } = await openAiChatPostWithUsage(
      fetchImpl,
      `${base}/v1/chat/completions`,
      base,
      headers(apiKey),
      body,
      signal,
    );
    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => "");
      yield {
        type: "error",
        layer: "upstream",
        code: String(response.status),
        message: errText.slice(0, 500),
        partial: { scenarioId, api_route: "chat_completions" },
      };
      return finalize(state, "budget_exhausted", null, state.lastVisible, state.lastCombined);
    }
    const m = await consumeOpenAiChatStream(response.body, signal);
    for (const ch of chunk(m.assistantText)) {
      yield { type: "token_delta", scenario_id: scenarioId, text: ch };
    }
    const turn: NormalizedTurn = {
      content: m.assistantText,
      reasoningText: m.reasoningText,
      toolCalls: (m.toolCalls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        argsJson: tc.function.arguments,
      })),
      usageOutputTokens: m.usageOutputTokens,
      ttftMs: m.ttftMs,
      totalMs: m.totalMs,
      streamCompleted: m.streamCompleted,
      toolArgsCorrupted: m.toolCallArgsCorrupted,
      combinedText: m.text,
    };
    const decision = stepAgentLoop(turn, def, loop, state, cursor);
    if (decision.kind === "final") {
      return finalize(state, decision.reason, decision.turnsToCompletion, decision.visible, decision.combined);
    }
    // 도구 라운드: assistant(tool_calls) + tool 결과 append 후 계속.
    messages.push({
      role: "assistant",
      content: m.assistantText || null,
      tool_calls: turn.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.argsJson },
      })),
    });
    for (const r of decision.toolResults) {
      messages.push({ role: "tool", tool_call_id: r.id, content: r.result });
    }
  }
  return finalize(state, "budget_exhausted", null, state.lastVisible, state.lastCombined);
}

// ─── Anthropic messages 하네스 ─────────────────────────────────────────────────
type AnthropicContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };
type AnthropicMsg = { role: "user" | "assistant"; content: string | AnthropicContent[] };

export async function* runAgentLoopAnthropic(
  args: AgentLoopArgs,
): AsyncGenerator<StreamEvent, AgentLoopResult> {
  const { base, apiKey, model, def, meta, scenarioId, fetchImpl, signal } = args;
  const loop = def.agentLoop!;
  const tools = runtimeToolsToAnthropic(def.tools);
  const messages: AnthropicMsg[] = [{ role: "user", content: def.user }];
  const state = initState();
  const cursor = new Map<string, number>();

  for (let t = 0; t < loop.maxTurns; t++) {
    const body: Record<string, unknown> = {
      model,
      system: def.system,
      messages,
      max_tokens: def.sampling?.max_tokens ?? args.maxTokens,
      temperature: def.sampling?.temperature ?? args.temperature,
      stream: true,
      ...(tools.length ? { tools } : {}),
      ...anthropicExtrasFromMeta(meta),
    };
    const requestT0 = args.requestStartedAt;
    const response = await fetchImpl(`${base}/v1/messages`, {
      method: "POST",
      headers: headers(apiKey, { "anthropic-version": "2023-06-01" }),
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => "");
      yield {
        type: "error",
        layer: "upstream",
        code: String(response.status),
        message: errText.slice(0, 500),
        partial: { scenarioId, api_route: "messages" },
      };
      return finalize(state, "budget_exhausted", null, state.lastVisible, state.lastCombined);
    }
    const m = await consumeAnthropicMessagesStream(
      response.body,
      signal,
      requestT0 != null ? { requestStartedAt: requestT0 } : undefined,
    );
    for (const ch of chunk(m.assistantText)) {
      yield { type: "token_delta", scenario_id: scenarioId, text: ch };
    }
    const turn: NormalizedTurn = {
      content: m.assistantText,
      reasoningText: m.reasoningText,
      toolCalls: (m.toolUses ?? []).map((tu) => ({
        id: tu.id,
        name: tu.name,
        argsJson: JSON.stringify(tu.input ?? {}),
      })),
      usageOutputTokens: m.usageOutputTokens,
      ttftMs: m.ttftMs,
      totalMs: m.totalMs,
      streamCompleted: m.streamCompleted,
      toolArgsCorrupted: false,
      combinedText: m.text,
    };
    const decision = stepAgentLoop(turn, def, loop, state, cursor);
    if (decision.kind === "final") {
      return finalize(state, decision.reason, decision.turnsToCompletion, decision.visible, decision.combined);
    }
    // 도구 라운드: assistant(text? + tool_use) + user(tool_result) append 후 계속.
    messages.push({
      role: "assistant",
      content: [
        ...(m.assistantText.trim() ? [{ type: "text" as const, text: m.assistantText }] : []),
        ...(m.toolUses ?? []).map((tu) => ({
          type: "tool_use" as const,
          id: tu.id,
          name: tu.name,
          input: tu.input,
        })),
      ],
    });
    messages.push({
      role: "user",
      content: decision.toolResults.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.id,
        content: r.result,
      })),
    });
  }
  return finalize(state, "budget_exhausted", null, state.lastVisible, state.lastCombined);
}
