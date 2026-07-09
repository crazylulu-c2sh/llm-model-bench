import { describe, expect, it } from "vitest";
import { scoreScenario } from "./scenarios.js";
import {
  consumeOpenAiChatStream,
  openAiBenchOutputText,
  openAiLiveTokenStreamText,
} from "./openai-stream.js";

function sse(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("consumeOpenAiChatStream", () => {
  it("records TTFT on first token and completes on [DONE]", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hello world from stream"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.text).toBe("Hello world from stream");
    expect(m.assistantText).toBe("Hello world from stream");
    expect(m.reasoningText).toBe("");
    expect(m.toolCalls).toBeNull();
    expect(m.ttftMs).not.toBeNull();
    expect(m.streamCompleted).toBe(true);
  });

  it("measures TTFT and totalMs from requestStartedAt when provided", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const requestStartedAt = performance.now() - 50;
    const m = await consumeOpenAiChatStream(stream, undefined, { requestStartedAt });
    expect(m.ttftMs).not.toBeNull();
    expect(m.ttftMs!).toBeGreaterThanOrEqual(45);
    expect(m.totalMs).toBeGreaterThanOrEqual(45);
  });

  it("merges streaming tool_calls into JSON and sets TTFT without content", async () => {
    const line = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
    const stream = sse([
      line({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", type: "function", function: { name: "get_weather", arguments: "" } },
              ],
            },
          },
        ],
      }),
      line({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":"' } }] } }],
      }),
      line({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'Seattle"}' } }] } }],
      }),
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.reasoningText).toBe("");
    expect(m.ttftMs).not.toBeNull();
    expect(m.streamCompleted).toBe(true);
    expect(m.text).toContain('"tool_calls"');
    expect(m.text).toContain("get_weather");
    expect(m.text).toContain("Seattle");
    const parsed = JSON.parse(m.text) as { tool_calls: { function: { name: string; arguments: string } }[] };
    expect(parsed.tool_calls[0].function.name).toBe("get_weather");
    expect(parsed.tool_calls[0].function.arguments).toBe('{"city":"Seattle"}');
  });

  it("appends tool_calls JSON after text when both present", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"content":"Calling tool."}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","type":"function","function":{"name":"get_weather","arguments":"{}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.reasoningText).toBe("");
    expect(m.text.startsWith("Calling tool.")).toBe(true);
    expect(m.text).toContain("\n");
    expect(m.text).toContain("get_weather");
  });

  it("flags toolCallArgsCorrupted when streamed arguments are concatenated (#1922)", async () => {
    // 엔진 프로토콜 런타임이 tool_call 인자를 `{"a":1}{"a":1}`처럼 이어붙여 내보내는 손상 시그니처.
    const stream = sse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","type":"function","function":{"name":"get_weather","arguments":"{\\"a\\":1}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"a\\":1}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.toolCallArgsCorrupted).toBe(true);
  });

  it("does not flag toolCallArgsCorrupted for a single valid JSON argument object", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\"Seattle\\"}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.toolCallArgsCorrupted).toBe(false);
  });

  it("does not flag toolCallArgsCorrupted for empty or {} arguments", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","type":"function","function":{"name":"get_weather","arguments":"{}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.toolCallArgsCorrupted).toBe(false);
  });

  it("does not flag toolCallArgsCorrupted when there are no tool calls", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"content":"plain answer"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.toolCallArgsCorrupted).toBe(false);
  });

  it("captures standard content deltas for translate scoring (baseline when upstream is OpenAI-shaped)", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"content":"비트코인은 디지털 화폐입니다."}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.reasoningText).toBe("");
    expect(
      scoreScenario("translate_nist_fips197_pdf_tools", m.assistantText, {
        invokedBenchTools: ["fetch_pdf_text"],
      }).pass,
    ).toBe(true);
  });

  it("accumulates reasoning_content-only streams into text (assistantText stays content-only)", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"reasoning_content":"think "}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"2026-04-20 2026-04-21"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.assistantText).toBe("");
    expect(m.reasoningText).toBe("think 2026-04-20 2026-04-21");
    expect(m.text).toBe("think 2026-04-20 2026-04-21");
    expect(m.ttftMs).not.toBeNull();
  });

  it("interleaves reasoning_content then content in text", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"reasoning_content":"[r]"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" visible"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.text).toBe("[r] visible");
    expect(m.assistantText).toBe(" visible");
    expect(m.reasoningText).toBe("[r]");
  });

  it("appends string delta.reasoning when present", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"reasoning":"alt "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"tail"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.text).toBe("alt tail");
    expect(m.assistantText).toBe("tail");
    expect(m.reasoningText).toBe("alt ");
  });
});

describe("openAiBenchOutputText", () => {
  it("prefers assistantText when non-empty", () => {
    expect(
      openAiBenchOutputText({
        ttftMs: 0,
        totalMs: 1,
        text: "full",
        assistantText: "visible",
        reasoningText: "think",
        toolCalls: null,
        streamCompleted: true,
        approxOutputTokens: 1,
        usageOutputTokens: null,
        finishReason: null,
        repetitionLoopDetected: false,
        toolCallArgsCorrupted: false,
      }),
    ).toBe("visible");
  });

  it("falls back to text when assistantText is blank", () => {
    expect(
      openAiBenchOutputText({
        ttftMs: 0,
        totalMs: 1,
        text: "reasoning-only",
        assistantText: "",
        reasoningText: "reasoning-only",
        toolCalls: null,
        streamCompleted: true,
        approxOutputTokens: 4,
        usageOutputTokens: null,
        finishReason: null,
        repetitionLoopDetected: false,
        toolCallArgsCorrupted: false,
      }),
    ).toBe("reasoning-only");
  });
});

describe("usage capture & onDelta", () => {
  it("captures usage.completion_tokens from terminal usage chunk", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"completion_tokens":7,"prompt_tokens":3,"total_tokens":10}}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.text).toBe("hi");
    expect(m.usageOutputTokens).toBe(7);
  });

  it("leaves usageOutputTokens null when provider does not send usage", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.usageOutputTokens).toBeNull();
  });

  it("captures finish_reason='length' for max_tokens truncation", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.finishReason).toBe("length");
  });

  it("captures finish_reason='stop' on normal completion", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.finishReason).toBe("stop");
  });

  it("leaves finishReason null when provider omits it", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.finishReason).toBeNull();
  });

  it("fires onDelta callback per content chunk when provided", async () => {
    const stream = sse([
      'data: {"choices":[{"delta":{"content":"he"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const deltas: string[] = [];
    const m = await consumeOpenAiChatStream(stream, undefined, {
      onDelta: (d) => {
        if (d.kind === "content") deltas.push(d.text);
      },
    });
    expect(m.assistantText).toBe("hello");
    expect(deltas).toEqual(["he", "llo"]);
  });
});

describe("loop guard", () => {
  const unit = "All work and no play makes Jack a dull boy. ";
  const looping = unit.repeat(40); // 1760 chars, heavy trailing block repeat

  it("detects a repetition loop and cancels the stream when loopGuard is on", async () => {
    let canceled = false;
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: looping } }] })}\n\n`),
        );
        // [DONE] intentionally appended; guard should break before consuming it.
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
      cancel() {
        canceled = true;
      },
    });
    const m = await consumeOpenAiChatStream(stream, undefined, { loopGuard: true });
    expect(m.repetitionLoopDetected).toBe(true);
    expect(m.streamCompleted).toBe(false);
    expect(canceled).toBe(true);
  });

  it("does NOT detect or cancel when loopGuard is omitted (stress/default behavior unchanged)", async () => {
    const stream = sse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: looping } }] })}\n\n`,
      "data: [DONE]\n\n",
    ]);
    const m = await consumeOpenAiChatStream(stream);
    expect(m.repetitionLoopDetected).toBe(false);
    expect(m.streamCompleted).toBe(true);
  });
});

describe("openAiLiveTokenStreamText", () => {
  it("concatenates reasoning then assistant content", () => {
    expect(
      openAiLiveTokenStreamText({
        ttftMs: 0,
        totalMs: 1,
        text: "x",
        assistantText: "out",
        reasoningText: "in",
        toolCalls: null,
        streamCompleted: true,
        approxOutputTokens: 1,
        usageOutputTokens: null,
        finishReason: null,
        repetitionLoopDetected: false,
        toolCallArgsCorrupted: false,
      }),
    ).toBe("inout");
  });
});
