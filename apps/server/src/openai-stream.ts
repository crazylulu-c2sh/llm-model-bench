export type OpenAiStreamMetrics = {
  ttftMs: number | null;
  totalMs: number;
  text: string;
  streamCompleted: boolean;
  approxOutputTokens: number;
};

type DeltaToolCall = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type MergedToolCall = {
  id?: string;
  callType?: string;
  name: string;
  arguments: string;
};

function mergeToolCallDeltas(deltas: DeltaToolCall[] | undefined, byIndex: Map<number, MergedToolCall>) {
  if (!deltas?.length) return;
  for (const p of deltas) {
    const idx = typeof p.index === "number" ? p.index : 0;
    let cur = byIndex.get(idx);
    if (!cur) {
      cur = { name: "", arguments: "" };
      byIndex.set(idx, cur);
    }
    if (p.id) cur.id = p.id;
    if (p.type) cur.callType = p.type;
    if (p.function?.name) cur.name = p.function.name;
    if (p.function?.arguments) cur.arguments += p.function.arguments;
  }
}

function serializeMergedToolCalls(byIndex: Map<number, MergedToolCall>): string {
  const entries = [...byIndex.entries()].sort((a, b) => a[0] - b[0]);
  const tool_calls = entries.map(([index, tc]) => ({
    index,
    id: tc.id,
    type: tc.callType ?? "function",
    function: {
      name: tc.name,
      arguments: tc.arguments,
    },
  }));
  return JSON.stringify({ tool_calls });
}

/** Parse OpenAI chat completions SSE stream; measure TTFT on first content or tool-call delta. */
export async function consumeOpenAiChatStream(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
): Promise<OpenAiStreamMetrics> {
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
  const toolByIndex = new Map<number, MergedToolCall>();
  const t0 = performance.now();
  let ttft: number | null = null;
  let streamCompleted = false;

  const markTtft = () => {
    if (ttft === null) ttft = performance.now() - t0;
  };

  const handleLine = (line: string) => {
    const s = line.trim();
    if (!s.startsWith("data:")) return;
    const data = s.slice(5).trim();
    if (data === "[DONE]") {
      streamCompleted = true;
      return;
    }
    try {
      const j = JSON.parse(data) as {
        choices?: {
          delta?: {
            content?: string;
            tool_calls?: DeltaToolCall[];
          };
        }[];
      };
      const delta = j.choices?.[0]?.delta;
      const c = delta?.content;
      if (c) {
        markTtft();
        text += c;
      }
      const tc = delta?.tool_calls;
      if (tc?.length) {
        markTtft();
        mergeToolCallDeltas(tc, toolByIndex);
      }
    } catch {
      /* ignore parse errors for partial chunks */
    }
  };

  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  const totalMs = performance.now() - t0;
  let outText = text;
  if (toolByIndex.size > 0) {
    const serialized = serializeMergedToolCalls(toolByIndex);
    if (outText) outText = `${outText}\n${serialized}`;
    else outText = serialized;
  }
  const approxOutputTokens = Math.max(0, Math.ceil(outText.length / 4));
  return {
    ttftMs: ttft,
    totalMs,
    text: outText,
    streamCompleted,
    approxOutputTokens,
  };
}

export function tpotFromOpenAi(m: OpenAiStreamMetrics): number | null {
  if (m.ttftMs === null || m.approxOutputTokens <= 1) return null;
  return (m.totalMs - m.ttftMs) / (m.approxOutputTokens - 1);
}
