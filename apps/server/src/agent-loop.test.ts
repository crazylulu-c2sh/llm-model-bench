import type { BenchRunMeta, ScenarioDef, StreamEvent } from "@llm-bench/shared";
import { ScenarioDefSchema } from "@llm-bench/shared";
import { describe, expect, it, vi } from "vitest";
import { runAgentLoopAnthropic, runAgentLoopOpenAi, type AgentLoopResult } from "./agent-loop.js";

const BASE = "http://127.0.0.1:1234";
const META = {} as BenchRunMeta; // extras 함수가 읽는 필드가 모두 optional → 빈 extras.

function def(overrides: Partial<ScenarioDef> = {}): ScenarioDef {
  return ScenarioDefSchema.parse({
    id: "al_test",
    system: "You are an agent. Produce a JSON answer when done.",
    user: "Summarize.",
    tools: [
      { name: "read_document", parameters: { type: "object" } },
      { name: "wiki_search", parameters: { type: "object", properties: { query: { type: "string" } } } },
    ],
    agentLoop: {
      maxTurns: 5,
      mockTools: [
        { tool: "read_document", responses: ["DOC-BODY"] },
        { tool: "wiki_search", responses: ["SEARCH-RESULT"] },
      ],
      completion: { type: "no_tool_calls" },
    },
    ...overrides,
  });
}

function sseResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) controller.enqueue(enc.encode(l));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

// ─── OpenAI SSE helpers ────────────────────────────────────────────────────────
function oaToolCall(name: string, args = "{}", content = ""): Response {
  const lines: string[] = [];
  if (content) lines.push(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  lines.push(
    `data: ${JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name, arguments: args } }] } }],
    })}\n\n`,
  );
  lines.push("data: [DONE]\n\n");
  return sseResponse(lines);
}
function oaText(content: string): Response {
  return sseResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    "data: [DONE]\n\n",
  ]);
}
function oaEmpty(): Response {
  return sseResponse([`data: ${JSON.stringify({ choices: [{ delta: {} }] })}\n\n`, "data: [DONE]\n\n"]);
}
/** reasoning_content 델타 + 최종 content(툴콜 없음) → 완료 턴. */
function oaReasoningText(reasoning: string, content: string): Response {
  return sseResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    "data: [DONE]\n\n",
  ]);
}
/** reasoning_content 델타 + tool_call(중간 턴). */
function oaToolCallReasoning(reasoning: string, name: string, args = "{}"): Response {
  return sseResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning } }] })}\n\n`,
    `data: ${JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name, arguments: args } }] } }],
    })}\n\n`,
    "data: [DONE]\n\n",
  ]);
}

/** turn별 Response 큐를 순서대로 돌려주는 fetchImpl. 요청 바디도 캡처. */
function queueFetch(responses: Response[]) {
  const bodies: Array<Record<string, unknown>> = [];
  let i = 0;
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    try {
      bodies.push(init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {});
    } catch {
      bodies.push({});
    }
    return responses[Math.min(i++, responses.length - 1)]!;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, bodies };
}

async function drive(
  gen: AsyncGenerator<StreamEvent, AgentLoopResult>,
): Promise<{ events: StreamEvent[]; result: AgentLoopResult }> {
  const events: StreamEvent[] = [];
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    step = await gen.next();
  }
  return { events, result: step.value };
}

const argsBase = (fetchImpl: typeof fetch) => ({
  base: BASE,
  model: "m",
  def: def(),
  meta: META,
  scenarioId: "al_test",
  fetchImpl,
  maxTokens: 512,
  temperature: 0,
});

describe("runAgentLoopOpenAi", () => {
  it("completed: feeds canned tool results across turns, tracks turns/rate", async () => {
    const { fetchImpl, bodies } = queueFetch([
      oaToolCall("read_document"),
      oaToolCall("wiki_search", '{"query":"aes"}'),
      oaText('{"title":"AES","summary":"s","sources":["aes"]}'),
    ]);
    const { result } = await drive(runAgentLoopOpenAi(argsBase(fetchImpl)));
    expect(result.metrics.completion_reason).toBe("completed");
    expect(result.metrics.turns_to_completion).toBe(3);
    expect(result.metrics.empty_turn_count).toBe(0);
    expect(result.metrics.valid_tool_call_rate).toBeCloseTo(2 / 3, 6);
    expect(result.metrics.intermediate_turn_leak).toBe(false);
    // canned 결과가 되먹여졌는지: 3번째 요청 messages에 tool 결과가 들어있어야 한다.
    const turn3 = bodies[2]!.messages as Array<{ role: string; content?: string }>;
    const toolMsgs = turn3.filter((m) => m.role === "tool").map((m) => m.content);
    expect(toolMsgs).toContain("DOC-BODY");
    expect(toolMsgs).toContain("SEARCH-RESULT");
  });

  it("stall: empty content + no tool calls → completion_reason=stall, empty_turn_count≥1", async () => {
    const { fetchImpl } = queueFetch([oaToolCall("read_document"), oaEmpty()]);
    const { result } = await drive(runAgentLoopOpenAi(argsBase(fetchImpl)));
    expect(result.metrics.completion_reason).toBe("stall");
    expect(result.metrics.turns_to_completion).toBeNull();
    expect(result.metrics.empty_turn_count).toBe(1);
  });

  it("budget_exhausted: every turn calls a tool until maxTurns", async () => {
    const { fetchImpl } = queueFetch([oaToolCall("read_document"), oaToolCall("read_document")]);
    const args = { ...argsBase(fetchImpl), def: def({ agentLoop: { ...def().agentLoop!, maxTurns: 2 } }) };
    const { result } = await drive(runAgentLoopOpenAi(args));
    expect(result.metrics.completion_reason).toBe("budget_exhausted");
    expect(result.metrics.turns_to_completion).toBeNull();
  });

  it("intermediate_turn_leak: think tags in an intermediate (tool) turn's content", async () => {
    const { fetchImpl } = queueFetch([
      oaToolCall("read_document", "{}", "<think>let me plan</think>"),
      oaText('{"title":"x","summary":"s","sources":[]}'),
    ]);
    const { result } = await drive(runAgentLoopOpenAi(argsBase(fetchImpl)));
    expect(result.metrics.intermediate_turn_leak).toBe(true);
    expect(result.metrics.completion_reason).toBe("completed");
  });

  it("reasoning_chars accumulates across turns (heavy synthesis turn + light final turn)", async () => {
    // 무거운 사고를 한 중간 합성 턴(30자) 뒤에 가벼운 최종 요약 턴(10자)이 오는 케이스.
    // 마지막-턴-기준이면 10 만 남아 사고 누수가 과소계상된다 — 누적이면 40.
    const { fetchImpl } = queueFetch([
      oaToolCallReasoning("x".repeat(30), "read_document"),
      oaReasoningText("y".repeat(10), '{"title":"AES","summary":"s","sources":[]}'),
    ]);
    const { result } = await drive(runAgentLoopOpenAi(argsBase(fetchImpl)));
    expect(result.metrics.completion_reason).toBe("completed");
    expect(result.reasoningChars).toBe(40); // 30 + 10 (전 턴 누적), 마지막 턴만이면 10
  });
});

// ─── Anthropic SSE helpers ─────────────────────────────────────────────────────
function anBlock(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
function anToolUse(name: string): Response {
  return sseResponse([
    anBlock("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name } }),
    anBlock("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }),
    anBlock("message_stop", { type: "message_stop" }),
  ]);
}
function anText(text: string): Response {
  return sseResponse([
    anBlock("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
    anBlock("message_stop", { type: "message_stop" }),
  ]);
}

describe("runAgentLoopAnthropic", () => {
  it("completed: tool_use turn then final text, feeds canned tool_result", async () => {
    const { fetchImpl, bodies } = queueFetch([
      anToolUse("read_document"),
      anText('{"title":"AES","summary":"s","sources":["aes"]}'),
    ]);
    const { result } = await drive(runAgentLoopAnthropic(argsBase(fetchImpl)));
    expect(result.metrics.completion_reason).toBe("completed");
    expect(result.metrics.turns_to_completion).toBe(2);
    // 2번째 요청 messages에 tool_result(DOC-BODY)가 들어가야 한다.
    const turn2 = bodies[1]!.messages as Array<{ role: string; content: unknown }>;
    const flat = JSON.stringify(turn2);
    expect(flat).toContain("tool_result");
    expect(flat).toContain("DOC-BODY");
  });
});
