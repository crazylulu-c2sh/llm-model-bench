import { detectRepetitionLoop } from "./repetition-guard.js";

export type OpenAiToolCallOut = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAiStreamMetrics = {
  ttftMs: number | null;
  totalMs: number;
  /**
   * reasoning_content / reasoning(문자열) 델타 + content 델타 순으로 누적한 전체 텍스트 +
   * (있으면) 줄바꿈 후 직렬화된 tool_calls JSON — 벤치 채점·output_text·토큰 델타 UI
   */
  text: string;
  /** `delta.content`만 (tool_calls·추론 채널 제외) — 도구 라운드 히스토리 등 */
  assistantText: string;
  /**
   * `delta.reasoning_content` + 문자열 `delta.reasoning` 누적 (MiniMax `reasoning_split` 등).
   * 히스토리 `reasoning_details` 재주입용; `assistantText`와 분리됨.
   */
  reasoningText: string;
  toolCalls: OpenAiToolCallOut[] | null;
  streamCompleted: boolean;
  approxOutputTokens: number;
  /** provider가 `stream_options.include_usage` 응답 청크로 보고한 출력 토큰 (없으면 null) */
  usageOutputTokens: number | null;
  /**
   * 마지막으로 보고된 `choices[0].finish_reason` — `"length"`면 max_tokens 도달로 잘림.
   * 일부 OpenAI 호환 서버(LM Studio·vLLM 등)는 이 필드를 보내지 않으므로 null 가능.
   */
  finishReason: string | null;
  /** `loopGuard` 활성 시, 반복 루프가 감지돼 `reader.cancel()`로 조기 종료했으면 true. */
  repetitionLoopDetected: boolean;
};

/** 증분 콜백 — 델타 도착 시마다 호출. stress-runner CCTV fan-out 용. */
export type OpenAiStreamDelta =
  | { kind: "content"; text: string }
  | { kind: "reasoning"; text: string };

export type OpenAiStreamOptions = {
  onDelta?: (delta: OpenAiStreamDelta) => void;
  /**
   * true면 누적 content에 대해 반복-루프 휴리스틱을 돌리고, 감지 시 `reader.cancel()`로 스트림을 조기 종료한다.
   * 미지정/false면 탐지·cancel을 전혀 수행하지 않음(기존 호출자 — stress 등 — 거동·오버헤드 불변).
   */
  loopGuard?: boolean;
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
  opts?: OpenAiStreamOptions,
): Promise<OpenAiStreamMetrics> {
  if (!body) {
    return {
      ttftMs: null,
      totalMs: 0,
      text: "",
      assistantText: "",
      reasoningText: "",
      toolCalls: null,
      streamCompleted: false,
      approxOutputTokens: 0,
      usageOutputTokens: null,
      finishReason: null,
      repetitionLoopDetected: false,
    };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  /** reasoning + content (채점·저장용) */
  let combined = "";
  /** delta.content 만 */
  let contentOnly = "";
  /** reasoning_content + 문자열 reasoning (히스토리 reasoning_details) */
  let reasoningOnly = "";
  const toolByIndex = new Map<number, MergedToolCall>();
  const t0 = performance.now();
  let ttft: number | null = null;
  let streamCompleted = false;
  let usageOutputTokens: number | null = null;
  let finishReason: string | null = null;
  const onDelta = opts?.onDelta;
  const loopGuard = opts?.loopGuard === true;
  let repetitionLoopDetected = false;
  let lastGuardCheckLen = 0;

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
            reasoning_content?: string;
            reasoning?: unknown;
            tool_calls?: DeltaToolCall[];
          };
          /** 마지막 청크에서 "stop" | "length" | "tool_calls" | "content_filter" 등이 채워짐. */
          finish_reason?: string | null;
        }[];
        usage?: { completion_tokens?: number; output_tokens?: number };
      };
      const fr = j.choices?.[0]?.finish_reason;
      if (typeof fr === "string" && fr.length > 0) {
        finishReason = fr;
      }
      if (j.usage) {
        const ct = typeof j.usage.completion_tokens === "number" ? j.usage.completion_tokens : null;
        const ot = typeof j.usage.output_tokens === "number" ? j.usage.output_tokens : null;
        if (ct != null && ct >= 0) usageOutputTokens = ct;
        else if (ot != null && ot >= 0) usageOutputTokens = ot;
      }
      const delta = j.choices?.[0]?.delta;
      const rc = delta?.reasoning_content;
      if (typeof rc === "string" && rc.length > 0) {
        markTtft();
        combined += rc;
        reasoningOnly += rc;
        if (onDelta) onDelta({ kind: "reasoning", text: rc });
      }
      const rsn = delta?.reasoning;
      if (typeof rsn === "string" && rsn.length > 0) {
        markTtft();
        combined += rsn;
        reasoningOnly += rsn;
        if (onDelta) onDelta({ kind: "reasoning", text: rsn });
      }
      const c = delta?.content;
      if (c) {
        markTtft();
        combined += c;
        contentOnly += c;
        if (onDelta) onDelta({ kind: "content", text: c });
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
    // 반복-루프 가드: content가 512자씩 늘 때마다 휴리스틱 검사. 감지 시 다음 read 전에 break해
    // (대기 중 read가 없어 AbortError 미발생) reader.cancel()로 백엔드 연결을 정상 종료한다.
    if (loopGuard && contentOnly.length - lastGuardCheckLen >= 512) {
      lastGuardCheckLen = contentOnly.length;
      if (detectRepetitionLoop(contentOnly).looping) {
        repetitionLoopDetected = true;
        break;
      }
    }
  }
  if (repetitionLoopDetected) {
    await reader.cancel().catch(() => undefined);
  }
  const totalMs = performance.now() - t0;
  const toolCallsForApi: OpenAiToolCallOut[] = [...toolByIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, tc]) => ({
      id: tc.id || `bench_tool_${index}`,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));
  let outText = combined;
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
    assistantText: contentOnly,
    reasoningText: reasoningOnly,
    toolCalls: toolCallsForApi.length ? toolCallsForApi : null,
    streamCompleted,
    approxOutputTokens,
    finishReason,
    usageOutputTokens,
    repetitionLoopDetected,
  };
}

export function tpotFromOpenAi(m: OpenAiStreamMetrics): number | null {
  if (m.ttftMs === null) return null;
  // provider 보고 실토큰(있으면) 우선, 없으면 글자수/4 근사. 숨은 추론 토큰도 usage에 포함되므로
  // messages 라우트처럼 추론이 output_text에 없을 때 TPOT가 비정상적으로 커지는 것을 막는다.
  const tokens =
    m.usageOutputTokens != null && m.usageOutputTokens > 0 ? m.usageOutputTokens : m.approxOutputTokens;
  if (tokens <= 1) return null;
  return (m.totalMs - m.ttftMs) / (tokens - 1);
}

/**
 * 채점·집계 `output_text`용: `delta.content`만 있는 `assistantText`를 우선하고,
 * 비어 있으면 `text`(reasoning + content + 필요 시 tool_calls JSON)로 폴백.
 * Interleaved(`reasoning_split`)에서 최종 턴이 추론 전용 델타만 줄 때 빈 문자열을 막는다.
 */
export function openAiBenchOutputText(m: OpenAiStreamMetrics): string {
  if (m.assistantText.trim()) return m.assistantText;
  return m.text;
}

/** 라이브 token_delta: 추론 델타가 있으면 앞에 붙여 스트림에 노출 */
export function openAiLiveTokenStreamText(m: OpenAiStreamMetrics): string {
  return `${m.reasoningText}${m.assistantText}`;
}
