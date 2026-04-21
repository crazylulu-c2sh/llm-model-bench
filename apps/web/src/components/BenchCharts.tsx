import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { avg, type ChartRow } from "./chart-types";

function barFill(pass: boolean | undefined, kind: "ttft" | "tpot"): string {
  if (pass === false) return "var(--chart-fail)";
  if (pass === true) return kind === "ttft" ? "var(--chart-ttft)" : "var(--chart-tpot)";
  return "var(--chart-neutral)";
}

function buildRadarByScenario(rows: ChartRow[]) {
  const m = new Map<string, number[]>();
  for (const r of rows) {
    if (r.ttft <= 0) continue;
    const arr = m.get(r.scenario) ?? [];
    arr.push(r.ttft);
    m.set(r.scenario, arr);
  }
  const maxMs = Math.max(1, ...[...m.values()].flat());
  return [...m.entries()].map(([subject, vals]) => {
    const v = vals.reduce((a, b) => a + b, 0) / vals.length;
    const short = subject.length > 12 ? `${subject.slice(0, 12)}…` : subject;
    return {
      subject: short,
      score: Math.round((v / maxMs) * 100),
    };
  });
}

export function BenchCharts({ chartRows }: { chartRows: ChartRow[] }) {
  const ttfts = chartRows.map((r) => r.ttft).filter((n) => n > 0);
  const tpots = chartRows.map((r) => r.tpot).filter((n) => n > 0);
  const avgTtft = avg(ttfts);
  const avgTpot = avg(tpots);
  const radarData = buildRadarByScenario(chartRows);

  if (!chartRows.length) {
    return (
      <p className="flex h-64 items-center justify-center text-sm text-[var(--muted)]">벤치 실행 후 메트릭이 표시됩니다.</p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="min-h-64">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis dataKey="labelShort" tick={{ fill: "var(--chart-tick)", fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={48} />
            <YAxis tick={{ fill: "var(--chart-tick)", fontSize: 10 }} width={44} />
            <Tooltip
              formatter={(value: number, name: string) => [`${Math.round(value)} ms`, name]}
              labelFormatter={(_, i) => {
                const r = chartRows[Number(i)];
                return r ? `${r.scenario} (${r.api})` : "";
              }}
              contentStyle={{
                background: "var(--chart-tooltip-bg)",
                border: "1px solid var(--chart-tooltip-border)",
                fontSize: 12,
                color: "var(--foreground)",
              }}
            />
            <Legend />
            {avgTtft !== undefined ? (
              <ReferenceLine
                y={avgTtft}
                stroke="var(--chart-ref-line)"
                strokeDasharray="4 4"
                label={{ value: `avg TTFT`, fill: "var(--chart-tick)", fontSize: 10 }}
              />
            ) : null}
            {avgTpot !== undefined ? (
              <ReferenceLine
                y={avgTpot}
                stroke="var(--chart-ref-line)"
                strokeDasharray="2 6"
                label={{ value: `avg TPOT`, fill: "var(--chart-tick)", fontSize: 10, position: "insideTopRight" }}
              />
            ) : null}
            <Bar dataKey="ttft" name="TTFT (ms)" radius={[2, 2, 0, 0]}>
              {chartRows.map((entry) => (
                <Cell key={`ttft-${entry.id}`} fill={barFill(entry.pass, "ttft")} />
              ))}
            </Bar>
            <Bar dataKey="tpot" name="TPOT (ms)" radius={[2, 2, 0, 0]}>
              {chartRows.map((entry) => (
                <Cell key={`tpot-${entry.id}`} fill={barFill(entry.pass, "tpot")} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="min-h-64">
        {radarData.length >= 2 ? (
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="var(--chart-grid)" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: "var(--chart-tick)", fontSize: 10 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "var(--chart-tick)", fontSize: 9 }} />
              <Radar
                name="TTFT 상대치"
                dataKey="score"
                stroke="var(--chart-ttft)"
                fill="var(--chart-ttft)"
                fillOpacity={0.35}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--chart-tooltip-bg)",
                  border: "1px solid var(--chart-tooltip-border)",
                  fontSize: 12,
                  color: "var(--foreground)",
                }}
                formatter={(v: number) => [`${v} / 100`, "정규화 TTFT"]}
              />
              <Legend />
            </RadarChart>
          </ResponsiveContainer>
        ) : (
          <p className="flex h-full min-h-64 items-center justify-center text-center text-sm text-[var(--muted)]">
            레이더 차트는 시나리오가 2개 이상일 때 표시됩니다.
          </p>
        )}
      </div>
    </div>
  );
}
