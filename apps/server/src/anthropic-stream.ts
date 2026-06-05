export type AnthropicToolUseOut = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type AnthropicStreamMetrics = {
  ttftMs: number | null;
  totalMs: number;
  /** reasoning(thinking) + 본문 content + (있으면) tool_calls JSON — throughput 지표·output_text 기준 */
  text: string;
  /** content_block_delta text만 (thinking 제외) — 채점용 가시 출력 */
  assistantText: string;
  /** thinking_delta(추론) 누적 — assistantText와 분리. OpenAI 소비자의 reasoningText와 동일 의미 */
  reasoningText: string;
  toolUses: AnthropicToolUseOut[] | null;
  streamCompleted: boolean;
  approxOutputTokens: number;
  /** provider 응답의 `message_delta.usage.output_tokens` (없으면 null) */
  usageOutputTokens: number | null;
  /**
   * `message_delta.delta.stop_reason` — `"end_turn"`, `"max_tokens"`,
   * `"stop_sequence"`, `"tool_use"` 중 하나. `"max_tokens"`면 한도 도달로 잘림.
   * 일부 호환 서버는 보내지 않으므로 null 가능.
   */
  stopReason: string | null;
};

export type AnthropicStreamDelta =
  | { kind: "content"; text: string }
  | { kind: "reasoning"; text: string };

export type AnthropicStreamOptions = {
  onDelta?: (delta: AnthropicStreamDelta) => void;
};

type ToolUseAcc = { name: string; id?: string; inputJson: string };

/** Minimal Anthropic messages SSE consumer (text + tool_use input_json_delta). */
export async function consumeAnthropicMessagesStream(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
  opts?: AnthropicStreamOptions,
): Promise<AnthropicStreamMetrics> {
  if (!body) {
    return {
      ttftMs: null,
      totalMs: 0,
      text: "",
      assistantText: "",
      reasoningText: "",
      toolUses: null,
      streamCompleted: false,
      approxOutputTokens: 0,
      usageOutputTokens: null,
      stopReason: null,
    };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  void buffer;
  let text = "";
  let reasoningText = "";
  const toolUseByIndex = new Map<number, ToolUseAcc>();
  const t0 = performance.now();
  let ttft: number | null = null;
  let sawMessageDelta = false;
  let usageOutputTokens: number | null = null;
  let lastStopReason: string | null = null;
  const onDelta = opts?.onDelta;

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
        delta?: {
          type?: string;
          text?: string;
          /** `thinking_delta` 이벤트의 추론 텍스트 */
          thinking?: string;
          partial_json?: string;
          /** `message_delta` 이벤트에서만 채워짐. `"max_tokens"` 등. */
          stop_reason?: string | null;
        };
        usage?: { output_tokens?: number };
        message?: { usage?: { output_tokens?: number } };
      };

      const usageOut =
        j.usage?.output_tokens ?? j.message?.usage?.output_tokens ?? null;
      if (typeof usageOut === "number" && usageOut >= 0) {
        usageOutputTokens = usageOut;
      }

      // `message_delta` 이벤트의 stop_reason 캡처. `sawMessageDelta`(스트림 완료 신호)와
      // 의미가 다르므로 별도 변수에 저장.
      if (j.type === "message_delta") {
        const sr = j.delta?.stop_reason;
        if (typeof sr === "string" && sr.length > 0) {
          lastStopReason = sr;
        }
      }

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
        // 추론(thinking) 델타 — 첫 생성 토큰이므로 TTFT를 마킹하고(OpenAI 소비자의 reasoning_content와 동일),
        // throughput 지표 기준에 포함되도록 reasoningText로 누적한다(가시 본문 text와는 분리 → 채점 비오염).
        if (j.delta?.type === "thinking_delta") {
          const r = j.delta.thinking;
          if (r) {
            markTtft();
            reasoningText += r;
            if (onDelta) onDelta({ kind: "reasoning", text: r });
          }
          return;
        }
        const t = j.delta?.text;
        if (t) {
          markTtft();
          text += t;
          if (onDelta) onDelta({ kind: "content", text: t });
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

  // throughput(approxOutputTokens) 기준은 생성된 전체 토큰(추론 + 가시 본문 + tool JSON)을 반영해
  // OpenAI 소비자(combined 기반)와 동일하게 맞춘다. `text`/`assistantText`(채점용)는 추론을 포함하지 않는다.
  const approxOutputTokens = Math.max(0, Math.ceil((reasoningText.length + outText.length) / 4));
  return {
    ttftMs: ttft,
    totalMs,
    text: outText,
    assistantText: text,
    reasoningText,
    toolUses: toolUses.length ? toolUses : null,
    streamCompleted: sawMessageDelta || outText.length > 0 || reasoningText.length > 0,
    approxOutputTokens,
    usageOutputTokens,
    stopReason: lastStopReason,
  };
}
