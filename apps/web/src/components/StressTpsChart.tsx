import type { StressStageResult } from "@llm-bench/shared";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  formatStressTpsTooltip,
  getTpsTier,
  TPS_TIER_LABEL_KO,
  TPS_TIER_THRESHOLDS,
  tpsTierColor,
  type TpsTier,
} from "../lib/tps-tier";

type ChartDatum = {
  concurrency: number;
  tps: number | null;
  tpsPerUser: number | null;
  unreliable: boolean;
  perUserTier: TpsTier | null;
};

export function StressTpsChart({ stages }: { stages: StressStageResult[] }) {
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
        동시 사용자 vs 집계 TPS
        <span className="ml-2 text-[11px] font-normal text-[var(--muted)]">
          사용자당 TPS 막대 색 = 체감 등급
        </span>
      </h2>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="concurrency"
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              label={{ value: "동시 사용자 수", position: "insideBottom", offset: -2, fill: "var(--muted)", fontSize: 11 }}
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
              formatter={(value: number, name: string, ctx: { dataKey?: string | number; payload?: ChartDatum }) => {
                const unreliable = ctx?.payload?.unreliable === true;
                const tier = ctx?.dataKey === "tpsPerUser" ? (ctx?.payload?.perUserTier ?? null) : null;
                const v = Number.isFinite(value) ? value : null;
                return [formatStressTpsTooltip(v, { unreliable, tier }), name];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value: string) =>
                value === "사용자당 TPS" ? "사용자당 TPS (색 = 체감 등급)" : value
              }
            />
            <Bar dataKey="tps" name="집계 TPS" fill="var(--accent)" />
            <Bar dataKey="tpsPerUser" name="사용자당 TPS">
              {data.map((d, i) => (
                <Cell key={`pu-${i}`} fill={tpsTierColor(d.perUserTier)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
        <span className="text-[var(--muted)]/80">사용자당 TPS:</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm" style={{ background: "var(--tier-fast)" }} />
          {TPS_TIER_LABEL_KO.fast} ≥ {TPS_TIER_THRESHOLDS.fast}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm" style={{ background: "var(--tier-good)" }} />
          {TPS_TIER_LABEL_KO.good} {TPS_TIER_THRESHOLDS.good}–{TPS_TIER_THRESHOLDS.fast - 1}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm" style={{ background: "var(--tier-okay)" }} />
          {TPS_TIER_LABEL_KO.okay} {TPS_TIER_THRESHOLDS.okay}–{TPS_TIER_THRESHOLDS.good - 1}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm" style={{ background: "var(--tier-slow)" }} />
          {TPS_TIER_LABEL_KO.slow} &lt; {TPS_TIER_THRESHOLDS.okay}
        </span>
        <span className="text-[var(--muted)]/70">· 표 집계 TPS의 <code className="font-mono">*</code>(신뢰도 낮음) 단계는 막대 생략 + 회색 · approx는 chars/4 추정이라 CJK에서 한 단계 낮게 보일 수 있음</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
        ramp 단계 종료마다 갱신됩니다. 동시성이 증가하다 TPS가 평탄해지면 처리량 한계, 하락하면 큐잉/리소스 경합 신호입니다.
      </p>
    </div>
  );
}
