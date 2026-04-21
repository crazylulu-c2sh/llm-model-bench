export type AnthropicStreamMetrics = {
  ttftMs: number | null;
  totalMs: number;
  text: string;
  streamCompleted: boolean;
  approxOutputTokens: number;
};

/** Minimal Anthropic messages SSE consumer (content_block_delta text). */
export async function consumeAnthropicMessagesStream(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
): Promise<AnthropicStreamMetrics> {
  if (!body) {
    return {
      ttftMs: null,
      totalMs: 0,
      text: "",
      streamCompleted: false,
      approxOutputTokens: 0,
    };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const t0 = performance.now();
  let ttft: number | null = null;
  let sawMessageDelta = false;

  const flushEventBlock = (block: string) => {
    const lines = block.split("\n");
    let event = "";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (event === "message_stop") sawMessageDelta = true;
    if (!data) return;
    try {
      const j = JSON.parse(data) as {
        type?: string;
        delta?: { text?: string };
      };
      if (j.type === "content_block_delta" && j.delta?.text) {
        if (ttft === null) ttft = performance.now() - t0;
        text += j.delta.text;
      }
    } catch {
      /* ignore */
    }
  };

  let carry = "";
  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const parts = carry.split("\n\n");
    carry = parts.pop() ?? "";
    for (const block of parts) {
      if (block.trim()) flushEventBlock(block);
    }
  }
  if (carry.trim()) flushEventBlock(carry);

  const totalMs = performance.now() - t0;
  const approxOutputTokens = Math.max(0, Math.ceil(text.length / 4));
  return {
    ttftMs: ttft,
    totalMs,
    text,
    streamCompleted: sawMessageDelta || text.length > 0,
    approxOutputTokens,
  };
}
