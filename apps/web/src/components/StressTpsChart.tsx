import type { StressStageResult } from "@llm-bench/shared";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function StressTpsChart({ stages }: { stages: StressStageResult[] }) {
  const data = stages.map((s) => ({
    concurrency: s.concurrency,
    tps: s.aggregate_tps ?? 0,
    tpsPerUser: s.tps_per_user ?? 0,
    unreliable: s.tps_unreliable === true,
  }));
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-[var(--foreground)]">동시 사용자 vs 집계 TPS</h2>
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
              formatter={(value: number, name: string, ctx: { payload?: { unreliable?: boolean } }) => {
                const unreliable = ctx?.payload?.unreliable;
                return [unreliable ? `${value} (신뢰도 낮음)` : value, name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="tps" name="집계 TPS" fill="var(--accent)" />
            <Bar dataKey="tpsPerUser" name="사용자당 TPS" fill="var(--accent-2, #888)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
        ramp 단계 종료마다 갱신됩니다. 동시성이 증가하다 TPS가 평탄해지면 처리량 한계, 하락하면 큐잉/리소스 경합 신호입니다.
      </p>
    </div>
  );
}
