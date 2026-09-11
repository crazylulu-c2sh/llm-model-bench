import { describe, expect, it } from "vitest";
import { consumeAnthropicMessagesStream } from "./anthropic-stream.js";

function block(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamFrom(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("consumeAnthropicMessagesStream", () => {
  it("accumulates tool_use input_json_delta into OpenAI-shaped tool_calls JSON", async () => {
    const body = streamFrom([
      block("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_1", name: "get_weather", input: {} },
      }),
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"city":"' },
      }),
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: 'Seattle"}' },
      }),
      block("message_stop", { type: "message_stop" }),
    ]);
    const m = await consumeAnthropicMessagesStream(body);
    expect(m.ttftMs).not.toBeNull();
    expect(m.text).toContain("get_weather");
    expect(m.text).toContain("Seattle");
    const parsed = JSON.parse(m.text) as { tool_calls: { function: { name: string; arguments: string } }[] };
    expect(parsed.tool_calls[0].function.name).toBe("get_weather");
    expect(parsed.tool_calls[0].function.arguments).toBe('{"city":"Seattle"}');
  });

  it("still merges plain text deltas", async () => {
    const body = streamFrom([
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hi" },
      }),
      block("message_stop", { type: "message_stop" }),
    ]);
    const m = await consumeAnthropicMessagesStream(body);
    expect(m.text).toBe("Hi");
    expect(m.ttftMs).not.toBeNull();
  });

  it("captures usage.output_tokens from message_delta", async () => {
    const body = streamFrom([
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      }),
      block("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 12 },
      }),
      block("message_stop", { type: "message_stop" }),
    ]);
    const m = await consumeAnthropicMessagesStream(body);
    expect(m.text).toBe("Hello");
    expect(m.usageOutputTokens).toBe(12);
    expect(m.usagePromptTokens).toBeNull();
  });

  it("captures usage.input_tokens from message_delta", async () => {
    const body = streamFrom([
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      }),
      block("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 12, input_tokens: 40 },
      }),
      block("message_stop", { type: "message_stop" }),
    ]);
    const m = await consumeAnthropicMessagesStream(body);
    expect(m.usageOutputTokens).toBe(12);
    expect(m.usagePromptTokens).toBe(40);
  });

  it("leaves usageOutputTokens null when message_delta omits usage", async () => {
    const body = streamFrom([
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hi" },
      }),
      block("message_stop", { type: "message_stop" }),
    ]);
    const m = await consumeAnthropicMessagesStream(body);
    expect(m.usageOutputTokens).toBeNull();
  });

  it("captures stop_reason='max_tokens' for truncation detection", async () => {
    const body = streamFrom([
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      }),
      block("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "max_tokens" },
        usage: { output_tokens: 5 },
      }),
      block("message_stop", { type: "message_stop" }),
    ]);
    const m = await consumeAnthropicMessagesStream(body);
    expect(m.stopReason).toBe("max_tokens");
  });

  it("captures stop_reason='end_turn' on normal completion", async () => {
    const body = streamFrom([
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hi" },
      }),
      block("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 1 },
      }),
      block("message_stop", { type: "message_stop" }),
    ]);
    const m = await consumeAnthropicMessagesStream(body);
    expect(m.stopReason).toBe("end_turn");
  });

  it("leaves stopReason null when message_delta omits stop_reason", async () => {
    const body = streamFrom([
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hi" },
      }),
      block("message_stop", { type: "message_stop" }),
    ]);
    const m = await consumeAnthropicMessagesStream(body);
    expect(m.stopReason).toBeNull();
  });

  it("captures thinking_delta into reasoningText, marks TTFT, and keeps text visible-only", async () => {
    const body = streamFrom([
      block("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking" },
      }),
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me reason carefully. " },
      }),
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Almost there. " },
      }),
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Final answer." },
      }),
      block("message_stop", { type: "message_stop" }),
    ]);
    const m = await consumeAnthropicMessagesStream(body);
    expect(m.ttftMs).not.toBeNull();
    expect(m.reasoningText).toBe("Let me reason carefully. Almost there. ");
    // 채점용 text/assistantText는 추론을 제외한 가시 본문만 — 채점 비오염 보장
    expect(m.text).toBe("Final answer.");
    expect(m.assistantText).toBe("Final answer.");
    // throughput 기준(approxOutputTokens)은 추론 + 본문을 반영
    expect(m.approxOutputTokens).toBe(
      Math.ceil((m.reasoningText.length + m.text.length) / 4),
    );
  });

  it("emits reasoning deltas via onDelta with kind 'reasoning'", async () => {
    const body = streamFrom([
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "hmm" },
      }),
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "ok" },
      }),
      block("message_stop", { type: "message_stop" }),
    ]);
    const kinds: string[] = [];
    const m = await consumeAnthropicMessagesStream(body, undefined, {
      onDelta: (d) => kinds.push(d.kind),
    });
    expect(kinds).toEqual(["reasoning", "content"]);
    expect(m.reasoningText).toBe("hmm");
    expect(m.text).toBe("ok");
  });

  it("fires onDelta callback per text_delta when provided", async () => {
    const body = streamFrom([
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hi" },
      }),
      block("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: " there" },
      }),
      block("message_stop", { type: "message_stop" }),
    ]);
    const deltas: string[] = [];
    const m = await consumeAnthropicMessagesStream(body, undefined, {
      onDelta: (d) => deltas.push(d.text),
    });
    expect(m.text).toBe("Hi there");
    expect(deltas).toEqual(["Hi", " there"]);
  });
});

describe("consumeAnthropicMessagesStream: 프레임 파싱 견고성 (#173)", () => {
  /** CRLF로 프레임을 구분하는 shim — SSE 규약상 적법하다. */
  function blockCrlf(event: string, data: unknown) {
    return `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
  }
  const textDelta = (t: string) => ({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: t },
  });

  it("CRLF 프레임을 LF와 동일하게 파싱한다", async () => {
    const m = await consumeAnthropicMessagesStream(
      streamFrom([blockCrlf("content_block_delta", textDelta("Hi")), blockCrlf("message_stop", { type: "message_stop" })]),
    );
    expect(m.text).toBe("Hi");
    expect(m.ttftMs).not.toBeNull();
    expect(m.streamCompleted).toBe(true);
  });

  it("CRLF 쌍이 청크 경계에 걸쳐도 프레임이 쪼개진다", async () => {
    // "…\r\n" 까지만 온 뒤 다음 청크가 "\r\ndata: …" 로 시작 — carry 이어붙이기가 깨지면 여기서 잡힌다.
    const first = `event: content_block_delta\r\ndata: ${JSON.stringify(textDelta("A"))}\r\n`;
    const second = `\r\nevent: content_block_delta\r\ndata: ${JSON.stringify(textDelta("B"))}\r\n\r\n`;
    const m = await consumeAnthropicMessagesStream(streamFrom([first, second]));
    expect(m.text).toBe("AB");
  });

  it("여러 data: 줄은 LF로 이어 붙인다 (멀티라인 JSON 페이로드)", async () => {
    const json = JSON.stringify(textDelta("multi"), null, 1); // 줄바꿈 포함
    const frame = "event: content_block_delta\n" + json.split("\n").map((l) => `data: ${l}`).join("\n") + "\n\n";
    const m = await consumeAnthropicMessagesStream(streamFrom([frame]));
    expect(m.text).toBe("multi");
  });

  it("data: [DONE] 을 스트림 완료로 인정한다", async () => {
    const m = await consumeAnthropicMessagesStream(
      streamFrom([block("content_block_delta", textDelta("x")), "data: [DONE]\n\n"]),
    );
    expect(m.streamCompleted).toBe(true);
  });

  it("content_block_start 없는 input_json_delta 도 TTFT를 찍고 도구 인자를 조립한다", async () => {
    const m = await consumeAnthropicMessagesStream(
      streamFrom([
        block("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"city":"Seoul"}' },
        }),
        block("message_stop", { type: "message_stop" }),
      ]),
    );
    expect(m.ttftMs).not.toBeNull();
    expect(m.toolUses?.[0]?.input).toEqual({ city: "Seoul" });
  });

  it("thinking_delta 가 text 에 추론을 담아도 잃지 않는다", async () => {
    const m = await consumeAnthropicMessagesStream(
      streamFrom([
        block("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", text: "reasoning here" },
        }),
        block("content_block_delta", textDelta("answer")),
        block("message_stop", { type: "message_stop" }),
      ]),
    );
    expect(m.reasoningText).toBe("reasoning here");
    expect(m.text).toBe("answer");
    expect(m.ttftMs).not.toBeNull();
    expect(m.sawThinkingBlock).toBe(true);
  });

  it("redacted_thinking 블록은 델타가 없어도 TTFT를 찍는다", async () => {
    const m = await consumeAnthropicMessagesStream(
      streamFrom([
        block("content_block_start", {
          type: "content_block_start",
          index: 0,
          content_block: { type: "redacted_thinking" },
        }),
        block("content_block_delta", textDelta("ok")),
        block("message_stop", { type: "message_stop" }),
      ]),
    );
    expect(m.sawThinkingBlock).toBe(true);
    expect(m.ttftMs).not.toBeNull();
  });

  it("sawThinkingBlock 은 thinking 블록이 없으면 false", async () => {
    const m = await consumeAnthropicMessagesStream(
      streamFrom([block("content_block_delta", textDelta("hi")), block("message_stop", { type: "message_stop" })]),
    );
    expect(m.sawThinkingBlock).toBe(false);
  });

  it("메타데이터 전용 이벤트는 TTFT를 찍지 않는다", async () => {
    const m = await consumeAnthropicMessagesStream(
      streamFrom([
        block("message_start", { type: "message_start", message: { usage: { output_tokens: 0 } } }),
        ": ping\n\n",
        block("message_delta", { type: "message_delta", usage: { output_tokens: 7 } }),
      ]),
    );
    expect(m.ttftMs).toBeNull();
    expect(m.usageOutputTokens).toBe(7);
  });
});
