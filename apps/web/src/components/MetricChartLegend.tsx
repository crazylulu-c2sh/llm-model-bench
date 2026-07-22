import { useI18n } from "../i18n";

/** 차트 하단 범례 + 결과 테이블 상단 안내에서 공통으로 쓰는 지표 설명 */

export function MetricChartLegend({ variant }: { variant: "session" | "compare" }) {
  const { m } = useI18n();
  const l = m.results.legend;
  return (
    <div className="mt-2 space-y-2 border-t border-[var(--border)] pt-2">
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-[var(--foreground)]">
        <span className="inline-flex items-center gap-2">
          <span className="size-3 shrink-0 rounded-sm bg-[var(--chart-ttft)]" aria-hidden />
          <span>
            <strong>TTFT</strong> (ms) — {l.ttftDesc}
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-3 shrink-0 rounded-sm bg-[var(--chart-tps)]" aria-hidden />
          <span>
            <strong>TPS</strong> (tok/s) — {l.tpsDesc}
            {variant === "session" ? l.tpsDescSession : l.tpsDescCompare}
          </span>
        </span>
      </div>
      {variant === "compare" ? (
        <p className="text-center text-[11px] leading-snug text-[var(--muted)]">
          {l.compareLead}
          <strong className="text-[var(--foreground)]">TTFT</strong>
          {l.compareMid}{" "}
          <strong className="text-[var(--foreground)]">TPS</strong>
          {l.compareTail}
        </p>
      ) : (
        <p className="text-center text-[11px] leading-snug text-[var(--muted)]">
          {l.sessionLead}
          <strong className="text-[var(--foreground)]">TTFT</strong>
          {l.sessionMid}
          <strong className="text-[var(--foreground)]">TPS</strong>
          {l.sessionTail}
        </p>
      )}
    </div>
  );
}

export function MetricTableIntro() {
  const { m } = useI18n();
  const l = m.results.legend;
  return (
    <div className="mb-3 space-y-2 border-b border-[var(--border)] pb-3 text-xs leading-relaxed text-[var(--muted)]">
      <p>
        <strong className="text-[var(--foreground)]">{l.scenarioTerm}</strong>
        {l.scenarioIs}{" "}
        <strong className="text-[var(--foreground)]">API</strong>
        {l.apiIs}{" "}
        <strong className="text-[var(--foreground)]">{l.modelTerm}</strong>
        {l.modelIs}
      </p>
      <p>
        <strong className="text-[var(--foreground)]">TTFT</strong>
        {l.ttftLead}{" "}
        <strong className="text-[var(--foreground)]">{l.outputTokensTerm}</strong>·
        <strong className="text-[var(--foreground)]">TPS</strong>
        {l.tokenCountLead}
        <code className="font-mono text-[11px]">usage.completion_tokens</code>
        {l.approxMid}
        <code className="font-mono text-[11px]">*</code>
        {l.approxTail}
      </p>
    </div>
  );
}
