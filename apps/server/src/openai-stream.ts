export type OpenAiStreamMetrics = {
  ttftMs: number | null;
  totalMs: number;
  text: string;
  streamCompleted: boolean;
  approxOutputTokens: number;
};

/** Parse OpenAI chat completions SSE stream; measure TTFT on first content delta. */
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
  const t0 = performance.now();
  let ttft: number | null = null;
  let streamCompleted = false;

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
        choices?: { delta?: { content?: string } }[];
      };
      const c = j.choices?.[0]?.delta?.content;
      if (c) {
        if (ttft === null) ttft = performance.now() - t0;
        text += c;
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
  const approxOutputTokens = Math.max(0, Math.ceil(text.length / 4));
  return {
    ttftMs: ttft,
    totalMs,
    text,
    streamCompleted,
    approxOutputTokens,
  };
}

export function tpotFromOpenAi(m: OpenAiStreamMetrics): number | null {
  if (m.ttftMs === null || m.approxOutputTokens <= 1) return null;
  return (m.totalMs - m.ttftMs) / (m.approxOutputTokens - 1);
}
