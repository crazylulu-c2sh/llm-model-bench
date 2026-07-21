import type { BenchRunMeta, ScenarioDef, StreamEvent } from "@llm-bench/shared";
import {
  AGENT_LOOP_CHAIN_V1,
  AGENT_LOOP_ERROR_V1,
  AGENT_LOOP_GROUNDING_V1,
  ScenarioDefSchema,
} from "@llm-bench/shared";
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
/** #101: reasoning_content 만 내고 finish_reason(+usage) 로 끝나는 턴(예산 소진 시그니처 재현용). */
function oaReasoningFinish(
  reasoning: string,
  finishReason: string | null,
  opts: { content?: string; usageTokens?: number } = {},
): Response {
  const lines: string[] = [
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning } }] })}\n\n`,
  ];
  if (opts.content) lines.push(`data: ${JSON.stringify({ choices: [{ delta: { content: opts.content } }] })}\n\n`);
  const finalChunk: Record<string, unknown> = { choices: [{ delta: {}, finish_reason: finishReason }] };
  if (opts.usageTokens != null) finalChunk.usage = { completion_tokens: opts.usageTokens };
  lines.push(`data: ${JSON.stringify(finalChunk)}\n\n`);
  lines.push("data: [DONE]\n\n");
  return sseResponse(lines);
}

/** #105: 최종 text 턴 + usage(효율 분자 final_turn_output_tokens 검증용). */
function oaTextUsage(content: string, usageTokens: number): Response {
  return sseResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { completion_tokens: usageTokens } })}\n\n`,
    "data: [DONE]\n\n",
  ]);
}
/** #105: tool_call 턴 + usage(합계 vs 최종턴 구분용). */
function oaToolCallUsage(name: string, args: string, usageTokens: number): Response {
  return sseResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name, arguments: args } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { completion_tokens: usageTokens } })}\n\n`,
    "data: [DONE]\n\n",
  ]);
}

/** #105: argDispatch(read_document.id) 시나리오 def. */
function argDispatchDef(): ScenarioDef {
  return ScenarioDefSchema.parse({
    id: "al_argdispatch",
    system: "You are an agent. Read the document by id, then answer JSON.",
    user: "Summarize.",
    tools: [{ name: "read_document", parameters: { type: "object", properties: { id: { type: "string" } } } }],
    agentLoop: {
      maxTurns: 5,
      mockTools: [
        {
          tool: "read_document",
          responses: ["UNUSED-SEQUENCE-BODY"],
          argDispatch: {
            argKey: "id",
            cases: { doc_aes: "AES-BODY", doc_des: "DES-BODY" },
            fallback: '{"error":"unknown_document_id"}',
          },
        },
      ],
      completion: { type: "no_tool_calls" },
    },
  });
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

  it("#101 thinking_exhausted_budget: reasoning-only turn ending finish_reason=length → stall + flag + reasoning captured", async () => {
    const { fetchImpl } = queueFetch([oaReasoningFinish("x".repeat(40), "length")]);
    const { result } = await drive(runAgentLoopOpenAi(argsBase(fetchImpl)));
    expect(result.metrics.completion_reason).toBe("stall");
    expect(result.metrics.thinking_exhausted_budget).toBe(true);
    expect(result.reasoningChars).toBeGreaterThan(0); // reasoning_content 는 캡처된다
  });

  it("#101 control: empty turn with finish_reason=stop → stall but thinking_exhausted_budget=false", async () => {
    const { fetchImpl } = queueFetch([oaReasoningFinish("x".repeat(40), "stop")]);
    const { result } = await drive(runAgentLoopOpenAi(argsBase(fetchImpl)));
    expect(result.metrics.completion_reason).toBe("stall");
    expect(result.metrics.thinking_exhausted_budget).toBe(false);
  });

  it("#101 fallback: finish_reason absent but usage>=max_tokens on an empty turn → thinking_exhausted_budget=true", async () => {
    // argsBase maxTokens=512, def() 는 sampling 없음 → per-turn 예산 512.
    const { fetchImpl } = queueFetch([oaReasoningFinish("x".repeat(40), null, { usageTokens: 512 })]);
    const { result } = await drive(runAgentLoopOpenAi(argsBase(fetchImpl)));
    expect(result.metrics.thinking_exhausted_budget).toBe(true);
  });

  // ─── #105: argDispatch 인자 충실도 ───────────────────────────────────────────
  it("#105 argDispatch hit: 인자 값이 cases에 매칭 → 해당 응답 되먹임 + hits/attempts=1/1", async () => {
    const { fetchImpl, bodies } = queueFetch([
      oaToolCall("read_document", '{"id":"doc_aes"}'),
      oaText('{"ok":true}'),
    ]);
    const { result } = await drive(runAgentLoopOpenAi({ ...argsBase(fetchImpl), def: argDispatchDef() }));
    expect(result.metrics.tool_arg_attempts).toBe(1);
    expect(result.metrics.tool_arg_hits).toBe(1);
    const turn2 = bodies[1]!.messages as Array<{ role: string; content?: string }>;
    expect(turn2.filter((m) => m.role === "tool").map((m) => m.content)).toContain("AES-BODY");
  });

  it("#105 argDispatch miss: 미지의 id → fallback 에러 되먹임 + hits/attempts=0/1", async () => {
    const { fetchImpl, bodies } = queueFetch([
      oaToolCall("read_document", '{"id":"doc_zzz"}'),
      oaText('{"ok":true}'),
    ]);
    const { result } = await drive(runAgentLoopOpenAi({ ...argsBase(fetchImpl), def: argDispatchDef() }));
    expect(result.metrics.tool_arg_attempts).toBe(1);
    expect(result.metrics.tool_arg_hits).toBe(0);
    const turn2 = bodies[1]!.messages as Array<{ role: string; content?: string }>;
    expect(turn2.filter((m) => m.role === "tool").map((m) => m.content).join()).toContain("unknown_document_id");
  });

  it("#105 argDispatch 인자 파싱 실패(잘린 인자) → miss", async () => {
    const { fetchImpl } = queueFetch([oaToolCall("read_document", "{not-json"), oaText('{"ok":true}')]);
    const { result } = await drive(runAgentLoopOpenAi({ ...argsBase(fetchImpl), def: argDispatchDef() }));
    expect(result.metrics.tool_arg_attempts).toBe(1);
    expect(result.metrics.tool_arg_hits).toBe(0);
  });

  it("#105 argDispatch 도구를 아예 호출 안 함 → attempts=0 (포기 신호; null 아님)", async () => {
    const { fetchImpl } = queueFetch([oaText('{"ok":true}')]);
    const { result } = await drive(runAgentLoopOpenAi({ ...argsBase(fetchImpl), def: argDispatchDef() }));
    expect(result.metrics.tool_arg_attempts).toBe(0);
    expect(result.metrics.tool_arg_hits).toBe(0);
  });

  it("#105 시퀀스 mock(argDispatch 없음) → tool_arg 카운터는 null(측정 대상 아님)", async () => {
    const { fetchImpl } = queueFetch([oaToolCall("read_document"), oaText("{}")]);
    const { result } = await drive(runAgentLoopOpenAi(argsBase(fetchImpl)));
    expect(result.metrics.tool_arg_attempts).toBeNull();
    expect(result.metrics.tool_arg_hits).toBeNull();
  });

  it("#105 final_turn_output_tokens = 최종(무도구) 턴 usage(전 턴 합계가 아님)", async () => {
    const { fetchImpl } = queueFetch([oaToolCallUsage("read_document", "{}", 40), oaTextUsage('{"ok":true}', 50)]);
    const { result } = await drive(runAgentLoopOpenAi(argsBase(fetchImpl)));
    expect(result.metrics.final_turn_output_tokens).toBe(50);
    expect(result.usageOutputTokens).toBe(90); // 전 턴 합계 40+50 — 최종 턴만이 아님
  });
});

// ─── #105: 신규 빌트인 스위트 주행(등록된 def) ─────────────────────────────────
describe("builtin agent scenario suite (#105)", () => {
  it("agent_loop_error_v1: wiki_read 재시도가 1차 에러 뒤 실제 본문을 받는다", async () => {
    const { fetchImpl, bodies } = queueFetch([
      oaToolCall("read_document"),
      oaToolCall("wiki_search", '{"query":"aes"}'),
      oaToolCall("wiki_read", '{"id":"aes"}'), // 1차 → retryable 에러
      oaToolCall("wiki_read", '{"id":"aes"}'), // 재시도 → 정상 본문
      oaText('{"title":"AES","summary":"s","sources":["aes"],"retried":true}'),
    ]);
    const { result } = await drive(runAgentLoopOpenAi({ ...argsBase(fetchImpl), def: AGENT_LOOP_ERROR_V1 }));
    expect(result.metrics.completion_reason).toBe("completed");
    // 4번째 요청(1차 wiki_read 결과 반영) = 에러 페이로드; 5번째(재시도 결과 반영) = 실제 본문.
    expect(JSON.stringify(bodies[3]!.messages)).toContain("retryable");
    expect(JSON.stringify(bodies[4]!.messages)).toContain("selected by NIST as FIPS-197");
  });

  it("agent_loop_grounding_v1: 정확한 id 2건 → fidelity 2/2", async () => {
    const { fetchImpl } = queueFetch([
      oaToolCall("catalog_search", '{"query":"crypto"}'),
      oaToolCall("catalog_read", '{"id":"rec_9f3a1c77-4b2e"}'),
      oaToolCall("catalog_read", '{"id":"rec_0d84e2ab-77f1"}'),
      oaText('{"answers":[]}'),
    ]);
    const { result } = await drive(runAgentLoopOpenAi({ ...argsBase(fetchImpl), def: AGENT_LOOP_GROUNDING_V1 }));
    expect(result.metrics.tool_arg_attempts).toBe(2);
    expect(result.metrics.tool_arg_hits).toBe(2);
  });

  it("agent_loop_grounding_v1: 잘린 id 1건 → fidelity 1/2(miss)", async () => {
    const { fetchImpl } = queueFetch([
      oaToolCall("catalog_search", '{"query":"crypto"}'),
      oaToolCall("catalog_read", '{"id":"rec_9f3a1c77"}'), // 잘린 id → miss
      oaToolCall("catalog_read", '{"id":"rec_0d84e2ab-77f1"}'),
      oaText('{"answers":[]}'),
    ]);
    const { result } = await drive(runAgentLoopOpenAi({ ...argsBase(fetchImpl), def: AGENT_LOOP_GROUNDING_V1 }));
    expect(result.metrics.tool_arg_attempts).toBe(2);
    expect(result.metrics.tool_arg_hits).toBe(1);
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
/** #105: tool_use + input_json(인자) 델타 — argDispatch 미러 테스트용. */
function anToolUseArgs(name: string, partialJson: string): Response {
  return sseResponse([
    anBlock("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name } }),
    anBlock("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: partialJson } }),
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

  it("#105 argDispatch hit (messages 라우트): 인자 매칭 → 해당 응답 + hits/attempts=1/1", async () => {
    const { fetchImpl, bodies } = queueFetch([
      anToolUseArgs("read_document", '{"id":"doc_des"}'),
      anText('{"ok":true}'),
    ]);
    const { result } = await drive(runAgentLoopAnthropic({ ...argsBase(fetchImpl), def: argDispatchDef() }));
    expect(result.metrics.tool_arg_attempts).toBe(1);
    expect(result.metrics.tool_arg_hits).toBe(1);
    expect(JSON.stringify(bodies[1]!.messages)).toContain("DES-BODY");
  });
});

// ─── #108 후속: per-tool 호출 카운터 ───────────────────────────────────────────
describe("tool_call_counts", () => {
  it("도구별로 정확히 집계되고, 같은 도구 반복 호출이 누적된다", async () => {
    const { fetchImpl } = queueFetch([
      oaToolCall("read_document"),
      oaToolCall("read_document"), // 재시도
      oaToolCall("wiki_search", '{"query":"aes"}'),
      oaText('{"ok":true}'),
    ]);
    const { result } = await drive(runAgentLoopOpenAi(argsBase(fetchImpl)));
    expect(result.metrics.tool_call_counts).toEqual({ read_document: 2, wiki_search: 1 });
  });

  it("미선언(mock 없는) 도구 호출은 세지 않는다", async () => {
    const { fetchImpl } = queueFetch([oaToolCall("nonexistent_tool"), oaText('{"ok":true}')]);
    const { result } = await drive(runAgentLoopOpenAi(argsBase(fetchImpl)));
    expect(result.metrics.tool_call_counts).toEqual({});
  });

  it("인자가 깨진 호출도 센다 — 시퀀스 mock 은 응답을 실제로 소비하므로 재시도로 인정해야 한다", async () => {
    const { fetchImpl } = queueFetch([oaToolCall("read_document", "{broken"), oaText('{"ok":true}')]);
    const { result } = await drive(runAgentLoopOpenAi(argsBase(fetchImpl)));
    expect(result.metrics.tool_call_counts.read_document).toBe(1);
    // 인자 품질은 별도 지표가 잰다(여기서 겹쳐 재지 않는다).
    expect(result.metrics.valid_tool_call_rate).toBeLessThan(1);
  });

  it("messages 라우트도 동일하게 집계한다", async () => {
    const { fetchImpl } = queueFetch([anToolUse("read_document"), anToolUse("read_document"), anText("{}")]);
    const { result } = await drive(runAgentLoopAnthropic(argsBase(fetchImpl)));
    expect(result.metrics.tool_call_counts).toEqual({ read_document: 2 });
  });
});

// #108 후속: error_v1 corpus 이동(에러가 read_document 로) 회귀 가드 — happy path 통합.
describe("agent_loop_error_v1 happy path (#108 후속)", () => {
  it("1차 에러 → 재시도 → 정상 본문 → 완주, read_document 2회로 집계", async () => {
    const { fetchImpl, bodies } = queueFetch([
      oaToolCall("read_document"), // 1차 → retryable 에러
      oaToolCall("read_document"), // 재시도 → 정상 본문
      oaText('{"title":"AES","summary":"s","sources":["aes"],"retried":true}'),
    ]);
    const { result } = await drive(
      runAgentLoopOpenAi({ ...argsBase(fetchImpl), def: AGENT_LOOP_ERROR_V1 }),
    );
    expect(result.metrics.completion_reason).toBe("completed");
    expect(result.metrics.tool_call_counts.read_document).toBe(2);
    // 2번째 요청엔 에러가, 3번째엔 실제 본문이 되먹여진다.
    expect(JSON.stringify(bodies[1]!.messages)).toContain("retryable");
    expect(JSON.stringify(bodies[2]!.messages)).toContain("Advanced Encryption Standard");
  });
});

// #113 후속: 방해 후보 + 기권 mock 배선 회귀 가드 — 이 시나리오의 성질은 "오답도 성공한다"이므로
// 배선이 무너지면(오답에 에러가 나면) 조용히 예전의 "틀릴 수 없는 구조"로 돌아간다.
describe("agent_loop_chain_v1 방해 후보 + 기권 (#113 후속)", () => {
  it("1차 search 는 후보 3개, 2차는 전부 superseded — 시퀀스가 조회 순서대로 나온다", async () => {
    const { fetchImpl, bodies } = queueFetch([
      oaToolCall("search", '{"topic":"first"}'),
      oaToolCall("resolve", '{"ref":"REF-B2"}'),
      oaToolCall("fetch", '{"record_id":"rec_ok_22b"}'),
      oaToolCall("search", '{"topic":"second"}'),
      oaText('{"results":[{"ref":"REF-B2","record_id":"rec_ok_22b","fact":"Thornbury / Larkspur 12 cycles."},{"abstained":true}]}'),
    ]);
    const { result } = await drive(runAgentLoopOpenAi({ ...argsBase(fetchImpl), def: AGENT_LOOP_CHAIN_V1 }));
    expect(result.metrics.completion_reason).toBe("completed");
    expect(result.metrics.tool_call_counts).toEqual({ search: 2, resolve: 1, fetch: 1 });
    // hop 결과가 되먹여진다: 1차 후보 → record_id → 본문 → 2차 후보(active 없음).
    expect(JSON.stringify(bodies[1]!.messages)).toContain("REF-B2");
    expect(JSON.stringify(bodies[2]!.messages)).toContain("rec_ok_22b");
    expect(JSON.stringify(bodies[3]!.messages)).toContain("Thornbury");
    const afterSecondSearch = JSON.stringify(bodies[4]!.messages);
    expect(afterSecondSearch).toContain("REF-D4");
    expect(afterSecondSearch).not.toContain('"status":"active"');
  });

  /** 이 시나리오의 핵심 함정 — 다른 시나리오와 달리 오답 인자에 안전망(fallback 에러)이 없다. */
  it("superseded ref 를 넘겨도 resolve·fetch 가 성공한다(그럴듯한 오답이 가능)", async () => {
    const { fetchImpl, bodies } = queueFetch([
      oaToolCall("search", '{"topic":"x"}'),
      oaToolCall("resolve", '{"ref":"REF-A1"}'),
      oaToolCall("fetch", '{"record_id":"rec_wr_10a"}'),
      oaText('{"results":[{"ref":"REF-A1","record_id":"rec_wr_10a","fact":"5 cycles."},{"abstained":true}]}'),
    ]);
    await drive(runAgentLoopOpenAi({ ...argsBase(fetchImpl), def: AGENT_LOOP_CHAIN_V1 }));
    const afterResolve = JSON.stringify(bodies[2]!.messages);
    expect(afterResolve).toContain("rec_wr_10a");
    expect(afterResolve).not.toContain("unknown_ref");
    const afterFetch = JSON.stringify(bodies[3]!.messages);
    expect(afterFetch).toContain("superseded");
    expect(afterFetch).not.toContain("unknown_record_id");
  });

  it("존재하지 않는 ref 는 여전히 fallback 에러(오타·환각은 걸린다)", async () => {
    const { fetchImpl, bodies } = queueFetch([
      oaToolCall("search", '{"topic":"x"}'),
      oaToolCall("resolve", '{"ref":"REF-ZZ"}'),
      oaText('{"results":[{"abstained":true},{"abstained":true}]}'),
    ]);
    await drive(runAgentLoopOpenAi({ ...argsBase(fetchImpl), def: AGENT_LOOP_CHAIN_V1 }));
    expect(JSON.stringify(bodies[2]!.messages)).toContain("unknown_ref");
  });
});
