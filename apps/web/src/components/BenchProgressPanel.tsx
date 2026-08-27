import { useLayoutEffect, useRef } from "react";
import { useI18n, type Messages } from "../i18n";
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

/** `remainingMs === null`이면 아직 근거가 없다는 뜻 — 렌더 자체를 생략(추정치를 지어내지 않음). */
export type BenchEta = { remainingMs: number | null; paused: boolean };

function apiShort(api: string): string {
  if (api === "chat_completions") return "chat";
  if (api === "messages") return "msg";
  return api;
}

/** 벤치 실행 중 헤더·요약에 쓰는 한 줄(실행 중 전용 톤). */
export function formatBenchRunningLine(current: BenchCurrent | null, b: Messages["bench"]): string {
  const parts = [
    current?.modelId,
    current?.api ? apiShort(current.api) : undefined,
    current?.scenario,
    current?.iterLabel,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : b.streamConnecting;
}

export function formatBenchProgressSummary({
  running,
  current,
  b,
}: {
  running: boolean;
  current: BenchCurrent | null;
  b: Messages["bench"];
}): string {
  if (running) return formatBenchRunningLine(current, b);
  const parts = [
    current?.modelId,
    current?.api ? apiShort(current.api) : undefined,
    current?.scenario,
    current?.iterLabel,
  ].filter(Boolean);
  return parts.length ? b.lastState(parts.join(" · ")) : b.benchIdle;
}

function lineClass(kind: BenchStepKind): string {
  if (kind === "err") return "text-[var(--danger)]";
  if (kind === "ok") return "text-[var(--chart-pass)]";
  if (kind === "warn") return "text-[var(--warning)]";
  return "text-[var(--muted)]";
}

/**
 * 실행 중 현재 위치 한 줄 + 이벤트 로그.
 *
 * 카드 크롬(제목·테두리)과 실행 제어 버튼·큐 칩·진행률·ETA는 감싸는 StepSection이 가진다.
 * 진행률 바를 여기서 렌더하지 않는 이유: AppHeader가 같은 수치로 이미 role="progressbar"를
 * 하나 노출하고 있어, 두 개가 되면 스크린리더가 같은 값을 두 번 읽는다.
 */
export function BenchProgressPanel({
  running,
  current,
  lines,
}: {
  running: boolean;
  current: BenchCurrent | null;
  lines: BenchStepLine[];
}) {
  const { m } = useI18n();
  const summary = formatBenchProgressSummary({ running, current, b: m.bench });
  const logScrollRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!running) return;
    const el = logScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [running, lines]);

  return (
    <div>
      <div className="mb-3 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--foreground)]">
        {summary}
      </div>

      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {m.bench.eventLogHeading}
      </h3>
      <ul
        ref={logScrollRef}
        className="max-h-40 overflow-y-auto rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 font-mono text-[11px] leading-relaxed"
        aria-label={m.bench.eventLogAria}
      >
        {lines.length === 0 ? (
          <li className="text-[var(--muted)]">{m.bench.eventLogEmpty}</li>
        ) : (
          lines.map((ln, i) => (
            <li key={`${ln.ts}-${i}`} className={lineClass(ln.kind)}>
              {formatTimeWithMs(ln.ts)} {ln.text}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
