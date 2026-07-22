import { useLayoutEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "../i18n";

export type StressCellStatus = "idle" | "requesting" | "streaming" | "done" | "error";

/** 응답 pre가 바닥에서 4px 이내인지. 사용자가 위로 스크롤하면 자동 스크롤 일시 중지 트리거. */
function isNearBottom(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
}

export function StressWorkerCell({
  workerIndex,
  status,
  userPrompt,
  systemPrompt,
  responseText,
  reasoningText,
  errorMessage,
  dimmed = false,
  requestCount = 0,
  lastTotalMs = null,
}: {
  workerIndex: number;
  status: StressCellStatus;
  userPrompt: string;
  systemPrompt?: string;
  responseText: string;
  reasoningText: string;
  errorMessage?: string;
  /** A안: 호출자가 `runStatus === "running" && i >= concurrency`로 계산해 전달. status는 영향 없음. */
  dimmed?: boolean;
  /** 이 워커가 전체 런 동안 발사한 누적 요청 수. */
  requestCount?: number;
  /** 마지막으로 완료된 요청의 total_ms (`request_end`에서만 갱신). */
  lastTotalMs?: number | null;
}) {
  const { m } = useI18n();
  const badge =
    status === "streaming"
      ? "bg-[var(--accent)]/20 text-[var(--accent)]"
      : status === "done"
      ? "bg-emerald-500/15 text-emerald-500"
      : status === "error"
      ? "bg-red-500/15 text-red-500"
      : status === "requesting"
      ? "bg-[var(--muted)]/20 text-[var(--muted)]"
      : "bg-[var(--surface)] text-[var(--muted)]";
  const label =
    status === "streaming"
      ? m.stress.worker.streaming
      : status === "done"
      ? m.stress.worker.done
      : status === "error"
      ? m.stress.worker.error
      : status === "requesting"
      ? m.stress.worker.requesting
      : m.stress.worker.idle;
  const streamingRing = status === "streaming" ? "ring-1 ring-[var(--accent)]/40" : "";
  // 상태 배지 aria-live는 대표 셀(worker 0)만 polite, 나머지는 off — 스트림 본문이 아닌 상태 전환만 낭독해 스크린리더 폭주 방지.
  const ariaLive: "polite" | "off" = workerIndex === 0 ? "polite" : "off";
  const dimClass = dimmed ? "opacity-50 grayscale" : "";

  // 자동 스크롤: streaming 중 응답이 max-height를 넘으면 항상 마지막 토큰이 보이도록.
  // 사용자가 위로 스크롤하면 flag로 일시 중지, 다시 바닥에 가까워지면 재개.
  // 새 요청(requestCount 증가) 시 flag 리셋.
  const responseRef = useRef<HTMLPreElement | null>(null);
  const userScrolledUpRef = useRef(false);
  useLayoutEffect(() => {
    userScrolledUpRef.current = false;
  }, [requestCount]);
  useLayoutEffect(() => {
    if (status !== "streaming") return;
    const el = responseRef.current;
    if (!el) return;
    if (userScrolledUpRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [responseText, status]);
  const onResponseScroll = () => {
    const el = responseRef.current;
    if (!el) return;
    userScrolledUpRef.current = !isNearBottom(el);
  };
  return (
    <article
      className={`rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-xs shadow-sm transition-opacity ${streamingRing} ${dimClass}`}
    >
      <header className="mb-1 flex items-center justify-between">
        <span className="font-mono font-semibold text-[var(--foreground)]">{m.stress.worker.userNumber(workerIndex + 1)}</span>
        <span aria-live={ariaLive} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${badge}`}>
          {status === "streaming" || status === "requesting" ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : null}
          {label}
        </span>
      </header>
      {systemPrompt ? (
        <details className="mb-1 text-[10px] text-[var(--muted)]">
          <summary className="cursor-pointer select-none">system</summary>
          <pre className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap font-mono">{systemPrompt}</pre>
        </details>
      ) : null}
      <div className="mb-1 text-[10px] text-[var(--muted)]">user</div>
      <pre className="mb-1 max-h-12 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-2)] p-1 font-mono text-[11px]">
        {userPrompt}
      </pre>
      <div className="mb-1 flex items-center gap-1 text-[10px] text-[var(--muted)]">
        <span>{m.stress.worker.response}</span>
        {reasoningText && status !== "done" ? (
          <span className="rounded bg-[var(--surface-2)] px-1 text-[10px]">{m.stress.worker.thinking}</span>
        ) : null}
      </div>
      <pre
        ref={responseRef}
        onScroll={onResponseScroll}
        aria-live="off"
        className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-2)] p-1 font-mono text-[11px] text-[var(--foreground)]"
      >
        {responseText || (status === "streaming" || status === "requesting" ? "…" : "")}
        {status === "streaming" ? <span className="ml-0.5 animate-pulse">▌</span> : null}
      </pre>
      {errorMessage ? (
        <div className="mt-1 truncate text-[10px] text-red-500" title={errorMessage}>{errorMessage}</div>
      ) : null}
      <footer className="mt-1 flex items-center justify-between text-[10px] text-[var(--muted)]">
        <span className="font-mono">{m.stress.worker.reqCount(requestCount)}</span>
        <span className="font-mono">{m.stress.worker.last(lastTotalMs != null ? `${Math.round(lastTotalMs)}ms` : "—")}</span>
      </footer>
    </article>
  );
}
