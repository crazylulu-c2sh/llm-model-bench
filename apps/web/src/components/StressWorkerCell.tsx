import { Loader2 } from "lucide-react";

export type StressCellStatus = "idle" | "requesting" | "streaming" | "done" | "error";

export function StressWorkerCell({
  workerIndex,
  status,
  userPrompt,
  systemPrompt,
  responseText,
  reasoningText,
  errorMessage,
  dimmed = false,
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
}) {
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
      ? "스트리밍"
      : status === "done"
      ? "완료"
      : status === "error"
      ? "오류"
      : status === "requesting"
      ? "요청 중"
      : "대기";
  const streamingRing = status === "streaming" ? "ring-1 ring-[var(--accent)]/40" : "";
  // 셀별 aria-live는 대표 셀(worker 0)만 polite, 나머지는 off로 스크린리더 폭주 방지.
  const ariaLive: "polite" | "off" = workerIndex === 0 ? "polite" : "off";
  const dimClass = dimmed ? "opacity-50 grayscale" : "";
  return (
    <article
      className={`rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-xs shadow-sm transition-opacity ${streamingRing} ${dimClass}`}
    >
      <header className="mb-1 flex items-center justify-between">
        <span className="font-mono font-semibold text-[var(--foreground)]">사용자 #{workerIndex + 1}</span>
        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${badge}`}>
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
        <span>응답</span>
        {reasoningText && status !== "done" ? (
          <span className="rounded bg-[var(--surface-2)] px-1 text-[10px]">🧠 사고 중</span>
        ) : null}
      </div>
      <pre
        aria-live={ariaLive}
        className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-2)] p-1 font-mono text-[11px] text-[var(--foreground)]"
      >
        {responseText || (status === "streaming" || status === "requesting" ? "…" : "")}
        {status === "streaming" ? <span className="ml-0.5 animate-pulse">▌</span> : null}
      </pre>
      {errorMessage ? (
        <div className="mt-1 truncate text-[10px] text-red-500" title={errorMessage}>{errorMessage}</div>
      ) : null}
    </article>
  );
}
