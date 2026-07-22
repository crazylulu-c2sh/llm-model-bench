import type { StressStageResult } from "@llm-bench/shared";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  formatStressTpsTooltip,
  getTpsTier,
  TPS_TIER_THRESHOLDS,
  tpsTierColor,
  type TpsTier,
} from "../lib/tps-tier";
import { useI18n } from "../i18n";

type ChartDatum = {
  concurrency: number;
  tps: number | null;
  tpsPerUser: number | null;
  unreliable: boolean;
  perUserTier: TpsTier | null;
};

export function StressTpsChart({ stages }: { stages: StressStageResult[] }) {
  const { m } = useI18n();
  const data: ChartDatum[] = stages.map((s) => {
    const unreliable = s.tps_unreliable === true;
    return {
      concurrency: s.concurrency,
      tps: unreliable ? null : (s.aggregate_tps ?? 0),
      tpsPerUser: unreliable ? null : (s.tps_per_user ?? 0),
      unreliable,
      perUserTier: getTpsTier(s.tps_per_user, unreliable),
    };
  });
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-[var(--foreground)]">
        {m.stress.chart.heading}
        <span className="ml-2 text-[11px] font-normal text-[var(--muted)]">
          {m.stress.chart.headingNote}
        </span>
      </h2>
      <div
        className="h-64 w-full"
        role="img"
        aria-label={m.stress.chart.ariaLabel}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="concurrency"
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              label={{ value: m.stress.chart.xLabel, position: "insideBottom", offset: -2, fill: "var(--muted)", fontSize: 11 }}
            />
            <YAxis
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              label={{ value: "TPS (tok/s)", angle: -90, position: "insideLeft", fill: "var(--muted)", fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
                fontSize: 12,
              }}
              formatter={(value, name, item) => {
                // Recharts v3: value=ValueType|undefined, name=NameType|undefined, item.payload is any.
                const p = item?.payload as ChartDatum | undefined;
                const unreliable = p?.unreliable === true;
                const tier = item?.dataKey === "tpsPerUser" ? (p?.perUserTier ?? null) : null;
                const num = Number(value);
                const v = Number.isFinite(num) ? num : null;
                return [formatStressTpsTooltip(v, { unreliable, tier }, m.stress), String(name)];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value: string) =>
                value === m.stress.chart.legendPerUser ? m.stress.chart.legendPerUserColored : value
              }
            />
            <Bar dataKey="tps" name={m.stress.chart.legendAggregate} fill="var(--accent)" />
            <Bar dataKey="tpsPerUser" name={m.stress.chart.legendPerUser}>
              {data.map((d, i) => (
                <Cell key={`pu-${i}`} fill={tpsTierColor(d.perUserTier)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
        <span className="text-[var(--muted)]">{m.stress.chart.perUserPrefix}</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm" style={{ background: "var(--tier-fast)" }} />
          {m.stress.tpsTier.fast} ≥ {TPS_TIER_THRESHOLDS.fast}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm" style={{ background: "var(--tier-good)" }} />
          {m.stress.tpsTier.good} {TPS_TIER_THRESHOLDS.good}–{TPS_TIER_THRESHOLDS.fast - 1}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm" style={{ background: "var(--tier-okay)" }} />
          {m.stress.tpsTier.okay} {TPS_TIER_THRESHOLDS.okay}–{TPS_TIER_THRESHOLDS.good - 1}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm" style={{ background: "var(--tier-slow)" }} />
          {m.stress.tpsTier.slow} &lt; {TPS_TIER_THRESHOLDS.okay}
        </span>
        <span className="text-[var(--muted)]">{m.stress.chart.footNoteBefore}<code className="font-mono">*</code>{m.stress.chart.footNoteAfter}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
        {m.stress.chart.explain}
      </p>
    </div>
  );
}
