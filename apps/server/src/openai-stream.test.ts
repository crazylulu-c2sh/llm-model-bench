import { describe, expect, it } from "vitest";
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
    expect(m.ttftMs).not.toBeNull();
    expect(m.streamCompleted).toBe(true);
    const tpot = tpotFromOpenAi(m);
    expect(tpot).not.toBeNull();
  });
});
