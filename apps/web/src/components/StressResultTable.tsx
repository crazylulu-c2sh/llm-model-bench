import type { StressStageResult, StressTpsSource } from "@llm-bench/shared";
import { getTpsTier, tpsTierColor, TPS_TIER_THRESHOLDS } from "../lib/tps-tier";
import { useI18n } from "../i18n";

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function sourceLabel(s: StressTpsSource): string {
  if (s === "usage") return "usage";
  if (s === "mixed") return "mixed";
  return "approx";
}

export function StressResultTable({ stages, expectedScript }: { stages: StressStageResult[]; expectedScript: "ko" | "ja" | "latin" }) {
  const { m } = useI18n();
  const perUserHeaderTitle = m.stress.table.perUserHeaderTitle(
    TPS_TIER_THRESHOLDS.fast,
    TPS_TIER_THRESHOLDS.good,
    TPS_TIER_THRESHOLDS.okay,
  );
  const hasApproxAnywhere = stages.some((s) => s.tps_source !== "usage");
  const allApprox = stages.length > 0 && stages.every((s) => s.tps_source === "approx");
  const hasUnreliableAnywhere = stages.some((s) => s.tps_unreliable === true);
  const hasTtftAnywhere = stages.some((s) => s.ttft_ms != null);
  const emptyColSpan = 9 + (expectedScript !== "latin" ? 1 : 0) + (hasTtftAnywhere ? 2 : 0);
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{m.stress.table.heading}</h2>
      <table className="min-w-full text-left text-xs">
        <caption className="sr-only">{m.stress.table.caption}</caption>
        <thead className="border-b border-[var(--border)] text-[var(--muted)]">
          <tr>
            <th scope="col" className="px-2 py-1">{m.stress.table.concurrency}</th>
            <th scope="col" className="px-2 py-1">TPS</th>
            <th scope="col" className="px-2 py-1" title={perUserHeaderTitle}>{m.stress.table.tpsPerUser}</th>
            <th scope="col" className="px-2 py-1">{m.stress.table.successRate}</th>
            <th scope="col" className="px-2 py-1">{hasTtftAnywhere ? m.stress.table.totalP50 : "p50"}</th>
            <th scope="col" className="px-2 py-1">{hasTtftAnywhere ? m.stress.table.totalP95 : "p95"}</th>
            {hasTtftAnywhere ? (
              <>
                <th scope="col" className="px-2 py-1" title={m.stress.table.ttftTitle}>TTFT p50</th>
                <th scope="col" className="px-2 py-1" title={m.stress.table.ttftTitle}>TTFT p95</th>
              </>
            ) : null}
            <th scope="col" className="px-2 py-1">{m.stress.table.errorRate}</th>
            <th scope="col" className="px-2 py-1">enqueue/drain (ms)</th>
            <th scope="col" className="px-2 py-1">source</th>
            {expectedScript !== "latin" ? <th scope="col" className="px-2 py-1">{m.stress.table.expectedResponseRate(expectedScript)}</th> : null}
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => {
            const successRate =
              s.requests_attempted > 0 ? s.requests_succeeded / s.requests_attempted : 0;
            const perUserTier = getTpsTier(s.tps_per_user, s.tps_unreliable === true);
            return (
              <tr key={s.stage_index} className="border-b border-[var(--border)] text-[var(--foreground)]">
                <td className="px-2 py-1 font-mono">{s.concurrency}</td>
                <td className="px-2 py-1 font-mono">
                  {s.tps_unreliable ? <span title={m.stress.table.lowConfidence}>{fmt(s.aggregate_tps, 1) ?? "—"}*</span> : fmt(s.aggregate_tps, 1)}
                </td>
                <td
                  className="px-2 py-1 font-mono"
                  style={{ color: tpsTierColor(perUserTier) }}
                  title={perUserTier ? m.stress.tpsTier[perUserTier] : undefined}
                >
                  {fmt(s.tps_per_user, 2)}
                  {perUserTier ? (
                    <span className="ml-1 text-[10px] text-[var(--muted)]">{m.stress.tpsTier[perUserTier]}</span>
                  ) : null}
                </td>
                <td className="px-2 py-1 font-mono">{(successRate * 100).toFixed(0)}%</td>
                <td className="px-2 py-1 font-mono">{s.latency_ms.p50 ?? "—"}</td>
                <td className="px-2 py-1 font-mono">{s.latency_ms.p95 ?? "—"}</td>
                {hasTtftAnywhere ? (
                  <>
                    <td className="px-2 py-1 font-mono">{s.ttft_ms?.p50 ?? "—"}</td>
                    <td className="px-2 py-1 font-mono">{s.ttft_ms?.p95 ?? "—"}</td>
                  </>
                ) : null}
                <td className="px-2 py-1 font-mono">{(s.error_rate * 100).toFixed(0)}%</td>
                <td className="px-2 py-1 font-mono">{s.enqueue_duration_ms} / {s.drain_ms}</td>
                <td className="px-2 py-1 font-mono">{sourceLabel(s.tps_source)}</td>
                {expectedScript !== "latin" ? (
                  <td className="px-2 py-1 font-mono">
                    {s.script_match_rate != null ? `${Math.round(s.script_match_rate * 100)}%` : "—"}
                  </td>
                ) : null}
              </tr>
            );
          })}
          {stages.length === 0 ? (
            <tr>
              <td className="px-2 py-2 text-[var(--muted)]" colSpan={emptyColSpan}>
                {m.stress.table.empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {hasApproxAnywhere ? (
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
          {allApprox
            ? m.stress.table.allApproxNote
            : (
              <>
                {m.stress.table.mixedNoteBefore}<code className="font-mono">approx</code>{m.stress.table.mixedNoteMid1}<code className="font-mono">mixed</code>{m.stress.table.mixedNoteMid2}<code className="font-mono">stream_options.include_usage</code>{m.stress.table.mixedNoteAfter}
              </>
            )}
        </p>
      ) : null}
      {hasUnreliableAnywhere ? (
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
          {m.stress.table.unreliableNoteBefore}<code className="font-mono">*</code>{m.stress.table.unreliableNoteMid}<code className="font-mono">—</code>{m.stress.table.unreliableNoteAfter}
        </p>
      ) : null}
    </div>
  );
}
