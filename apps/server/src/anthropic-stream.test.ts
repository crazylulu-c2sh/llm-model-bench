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
