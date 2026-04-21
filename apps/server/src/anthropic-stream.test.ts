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
});
