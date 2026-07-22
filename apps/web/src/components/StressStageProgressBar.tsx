import { useEffect, useRef } from "react";
import { useI18n, msg } from "../i18n";

/**
 * 단계 진행 프로그레스 바.
 * - React state 미사용 — RAF 루프에서 `style.width`와 `aria-valuenow`를 동시 갱신.
 * - `runStatus === "running"` && `stageStartedAt != null` && `stageDurationMs != null`일 때만 렌더.
 * - 언마운트 / 의존성 변경 시 `cancelAnimationFrame`으로 정리.
 * - elapsed > durationMs면 width=100% 고정 + `drain 중…` 텍스트.
 */
export function StressStageProgressBar({
  stageStartedAt,
  stageDurationMs,
}: {
  stageStartedAt: number;
  stageDurationMs: number;
}) {
  const { m } = useI18n();
  const barRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const elapsed = performance.now() - stageStartedAt;
      const ratio = stageDurationMs > 0 ? Math.min(1, elapsed / stageDurationMs) : 0;
      const pct = Math.round(ratio * 100);
      const fill = fillRef.current;
      const bar = barRef.current;
      const label = labelRef.current;
      if (fill) fill.style.width = `${pct}%`;
      if (bar) {
        const t = msg().stress.progress;
        bar.setAttribute("aria-valuenow", String(pct));
        bar.setAttribute(
          "aria-valuetext",
          elapsed > stageDurationMs ? t.valueTextDraining(pct) : t.valueText(pct),
        );
      }
      if (label) label.textContent = elapsed > stageDurationMs ? msg().stress.progress.draining : `${pct}%`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [stageStartedAt, stageDurationMs]);

  return (
    <div className="mt-1 flex items-center gap-2">
      <div
        ref={barRef}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        aria-valuetext={m.stress.progress.valueText(0)}
        aria-label={m.stress.progress.label}
        className="h-1 flex-1 overflow-hidden rounded bg-[var(--surface)]"
      >
        <div ref={fillRef} className="h-full bg-[var(--accent)]" style={{ width: "0%" }} />
      </div>
      <span ref={labelRef} className="font-mono text-[10px] text-[var(--muted)]">0%</span>
    </div>
  );
}
