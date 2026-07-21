import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import { Activity, Loader2 } from "lucide-react";
import { formatTimeWithMs } from "../lib/time-format";

export type BenchStepKind = "info" | "ok" | "err" | "warn";

export type BenchStepLine = { ts: number; kind: BenchStepKind; text: string };

export type BenchCurrent = {
  modelId: string;
  scenario?: string;
  api?: string;
  phase?: "warmup" | "measured" | "aggregate";
  /** 예: 워밍업 1/1, 측정 2/3 */
  iterLabel?: string;
};

export type BenchProgressStats = { completed: number; total: number; pct: number };

function apiShort(api: string): string {
  if (api === "chat_completions") return "chat";
  if (api === "messages") return "msg";
  return api;
}

/** 벤치 실행 중 헤더·요약에 쓰는 한 줄(실행 중 전용 톤). */
export function formatBenchRunningLine(current: BenchCurrent | null): string {
  const parts = [
    current?.modelId,
    current?.api ? apiShort(current.api) : undefined,
    current?.scenario,
    current?.iterLabel,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "스트림 연결 중…";
}

export function formatBenchProgressSummary({
  running,
  current,
}: {
  running: boolean;
  current: BenchCurrent | null;
}): string {
  if (running) return formatBenchRunningLine(current);
  const parts = [
    current?.modelId,
    current?.api ? apiShort(current.api) : undefined,
    current?.scenario,
    current?.iterLabel,
  ].filter(Boolean);
  return parts.length ? `마지막 상태 · ${parts.join(" · ")}` : "벤치 대기 중. 모델을 선택한 뒤 실행하세요.";
}

function lineClass(kind: BenchStepKind): string {
  if (kind === "err") return "text-[var(--danger)]";
  if (kind === "ok") return "text-[var(--chart-pass)]";
  if (kind === "warn") return "text-[var(--warning)]";
  return "text-[var(--muted)]";
}

export function BenchProgressPanel({
  running,
  current,
  lines,
  progress,
  benchAction,
  className,
}: {
  running: boolean;
  current: BenchCurrent | null;
  lines: BenchStepLine[];
  progress?: BenchProgressStats;
  benchAction?: ReactNode;
  /** 부모에서 벤치 라이브 테두리 등 유틸 클래스 주입 */
  className?: string;
}) {
  const summary = formatBenchProgressSummary({ running, current });
  const logScrollRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!running) return;
    const el = logScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [running, lines]);

  return (
    <section
      className={["rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4", className].filter(Boolean).join(" ")}
      aria-labelledby="bench-progress-heading"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-2">
        <h2 id="bench-progress-heading" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
          {running ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-[var(--accent)]" aria-hidden />
          ) : (
            <Activity className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
          )}
          벤치 실행 단계
        </h2>
        {benchAction ? <div className="flex shrink-0 flex-wrap items-center gap-2">{benchAction}</div> : null}
      </div>

      <div className="mb-3 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--foreground)]">
        {summary}
      </div>

      {progress && progress.total > 0 ? (
        <div className="mb-3">
          <div role="status" className="mb-1 flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
            <span className="font-semibold uppercase tracking-wide">실행률</span>
            <span className="font-mono tabular-nums text-[var(--foreground)]">
              {progress.pct}% · {progress.completed}/{progress.total}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.pct}
            aria-valuetext={`실행률 ${progress.pct}% · ${progress.completed}/${progress.total}`}
            className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]"
          >
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ease-out"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      ) : null}

      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">이벤트 로그</h3>
        <ul
          ref={logScrollRef}
          className="max-h-40 overflow-y-auto rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 font-mono text-[11px] leading-relaxed"
          aria-label="벤치 스트림 이벤트 로그"
        >
          {lines.length === 0 ? (
            <li className="text-[var(--muted)]">이벤트 수신 대기…</li>
          ) : (
            lines.map((ln, i) => (
              <li key={`${ln.ts}-${i}`} className={lineClass(ln.kind)}>
                {formatTimeWithMs(ln.ts)} {ln.text}
              </li>
            ))
          )}
        </ul>
      </div>
    </section>
  );
}
