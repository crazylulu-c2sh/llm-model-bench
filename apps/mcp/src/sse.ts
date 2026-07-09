/**
 * SSE 프레임 파서 — apps/web App.tsx의 consumeSseJsonLines 이식.
 * 서버는 `data: <json>\n\n` 프레임을 보낸다(event: 이름 없음). 각 data 라인의 JSON을 onEvent로 전달.
 */
export async function consumeSseJsonLines<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (ev: T) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const json = trimmed.slice(5).trim();
          if (!json) continue;
          try {
            onEvent(JSON.parse(json) as T);
          } catch {
            /* 부분 프레임/비JSON은 무시 */
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
