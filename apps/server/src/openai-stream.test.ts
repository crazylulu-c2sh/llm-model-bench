import { describe, expect, it } from "vitest";
import { scoreScenario } from "./scenarios.js";
import { consumeOpenAiChatStream, tpotFromOpenAi } from "./openai-stream.js";

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
    const tpot = tpotFromOpenAi(m);
    expect(tpot).not.toBeNull();
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
