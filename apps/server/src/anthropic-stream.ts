export type AnthropicToolUseOut = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type AnthropicStreamMetrics = {
  ttftMs: number | null;
  totalMs: number;
  text: string;
  assistantText: string;
  toolUses: AnthropicToolUseOut[] | null;
  streamCompleted: boolean;
  approxOutputTokens: number;
};

type ToolUseAcc = { name: string; id?: string; inputJson: string };

/** Minimal Anthropic messages SSE consumer (text + tool_use input_json_delta). */
export async function consumeAnthropicMessagesStream(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
): Promise<AnthropicStreamMetrics> {
  if (!body) {
    return {
      ttftMs: null,
      totalMs: 0,
      text: "",
      assistantText: "",
      toolUses: null,
      streamCompleted: false,
      approxOutputTokens: 0,
    };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const toolUseByIndex = new Map<number, ToolUseAcc>();
  const t0 = performance.now();
  let ttft: number | null = null;
  let sawMessageDelta = false;

  const markTtft = () => {
    if (ttft === null) ttft = performance.now() - t0;
  };

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
        index?: number;
        content_block?: { type?: string; id?: string; name?: string };
        delta?: { type?: string; text?: string; partial_json?: string };
      };

      if (j.type === "content_block_start" && j.content_block?.type === "tool_use") {
        const idx = j.index ?? 0;
        toolUseByIndex.set(idx, {
          name: j.content_block.name ?? "",
          id: j.content_block.id,
          inputJson: "",
        });
        markTtft();
        return;
      }

      if (j.type === "content_block_delta") {
        const idx = j.index ?? 0;
        if (j.delta?.type === "input_json_delta" && j.delta.partial_json != null) {
          const tu = toolUseByIndex.get(idx);
          if (tu) {
            tu.inputJson += j.delta.partial_json;
            markTtft();
          }
          return;
        }
        const t = j.delta?.text;
        if (t) {
          markTtft();
          text += t;
        }
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
  const toolUses: AnthropicToolUseOut[] = [...toolUseByIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, tu]) => {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tu.inputJson || "{}") as Record<string, unknown>;
      } catch {
        input = {};
      }
      return {
        id: tu.id || `toolu_bench_${index}`,
        name: tu.name,
        input,
      };
    });
  let outText = text;
  if (toolUseByIndex.size > 0) {
    const tool_calls = [...toolUseByIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, tu]) => ({
        index,
        id: tu.id,
        type: "function" as const,
        function: { name: tu.name, arguments: tu.inputJson },
      }));
    const serialized = JSON.stringify({ tool_calls });
    outText = outText ? `${outText}\n${serialized}` : serialized;
  }

  const approxOutputTokens = Math.max(0, Math.ceil(outText.length / 4));
  return {
    ttftMs: ttft,
    totalMs,
    text: outText,
    assistantText: text,
    toolUses: toolUses.length ? toolUses : null,
    streamCompleted: sawMessageDelta || outText.length > 0,
    approxOutputTokens,
  };
}
