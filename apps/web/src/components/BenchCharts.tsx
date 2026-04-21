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
import { avg, pivotCompareSeries, type ChartRow, type CompareSeries } from "./chart-types";
import { MetricChartLegend } from "./MetricChartLegend";

/** Recharts 기본 스타일이 툴팁 자식에 검정 텍스트를 남기지 않도록 공통 지정 */
const rechartsTooltipShell = {
  contentStyle: {
    background: "var(--chart-tooltip-bg)",
    border: "1px solid var(--chart-tooltip-border)",
    fontSize: 12,
    color: "var(--chart-tooltip-fg)",
  },
  labelStyle: {
    color: "var(--chart-tooltip-label)",
    marginBottom: 4,
    fontSize: 11,
    fontWeight: 500,
  },
  itemStyle: { color: "var(--chart-tooltip-fg)" },
  cursor: { fill: "var(--chart-cursor)" },
} as const;

function barFill(pass: boolean | undefined, kind: "ttft" | "tpot" | "tps"): string {
  if (pass === false) return "var(--chart-fail)";
  if (pass === true) {
    if (kind === "ttft") return "var(--chart-ttft)";
    if (kind === "tpot") return "var(--chart-tpot)";
    return "var(--chart-tps)";
  }
  return "var(--chart-neutral)";
}

function modelColor(i: number, kind: "ttft" | "tpot" | "tps"): string {
  const hues = [200, 145, 280, 35, 12, 320];
  const h = hues[i % hues.length];
  const l = kind === "ttft" ? 55 : kind === "tpot" ? 45 : 62;
  return `hsl(${h} 70% ${l}%)`;
}

function tooltipMetricFormatter(value: number, name: string): [string, string] {
  const n = String(name);
  if (n.includes("TPS")) return [Number.isFinite(value) ? `${Math.round(value * 10) / 10} tok/s` : "—", name];
  return [`${Math.round(value)} ms`, name];
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
    const short = subject.length > 14 ? `${subject.slice(0, 14)}…` : subject;
    return {
      subject: short,
      score: Math.round((v / maxMs) * 100),
    };
  });
}

function slugifyModelId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 48) || "m";
}

type BenchChartsProps = {
  chartRows: ChartRow[];
  compareSeries?: CompareSeries[] | null;
  onBarPayload?: (row: ChartRow) => void;
  onCompareCell?: (scenario: string, api: string) => void;
};

export function BenchCharts({ chartRows, compareSeries, onBarPayload, onCompareCell }: BenchChartsProps) {
  const compareMode = compareSeries && compareSeries.length >= 2;
  const pivoted = compareMode ? pivotCompareSeries(compareSeries) : [];
  const compareChartHeight = compareMode ? Math.min(620, Math.max(440, pivoted.length * 42)) : 400;

  if (compareMode) {
    const rows = pivoted.map((p) => {
      const o: Record<string, string | number | undefined> = {
        label: p.label,
        scenario: p.scenario,
        api: p.api,
      };
      compareSeries.forEach((s, si) => {
        const slug = slugifyModelId(s.modelId);
        const v = p.byModel[s.modelId];
        o[`${slug}_ttft`] = v?.ttft ?? 0;
        o[`${slug}_tpot`] = v?.tpot ?? 0;
        o[`${slug}_tps`] = v?.tps ?? 0;
        o[`__pass_${si}`] = v?.pass === false ? 0 : 1;
      });
      return o;
    });

    const tpss = compareSeries.flatMap((s) => s.rows.map((r) => r.tps)).filter((n) => n > 0);
    const avgTpsCompare = avg(tpss);

    return (
      <div className="grid gap-8 lg:grid-cols-2">
        <div style={{ minHeight: compareChartHeight }}>
          <ResponsiveContainer width="100%" height={compareChartHeight}>
            <BarChart
              layout="vertical"
              data={rows}
              margin={{ top: 36, right: 24, left: 8, bottom: 28 }}
              onClick={(e) => {
                const p = e?.activePayload?.[0]?.payload as Record<string, unknown> | undefined;
                if (p?.scenario && p?.api) onCompareCell?.(String(p.scenario), String(p.api));
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
              <XAxis xAxisId="ms" type="number" tick={{ fill: "var(--chart-tick)", fontSize: 10 }} />
              <XAxis
                xAxisId="tps"
                type="number"
                orientation="top"
                tick={{ fill: "var(--chart-tick)", fontSize: 9 }}
                axisLine={{ stroke: "var(--chart-grid)" }}
                tickLine={{ stroke: "var(--chart-grid)" }}
                label={{ value: "tok/s", position: "insideTopRight", fill: "var(--chart-tick)", fontSize: 10 }}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={200}
                tick={{ fill: "var(--chart-tick)", fontSize: 10 }}
                interval={0}
              />
              <Tooltip {...rechartsTooltipShell} formatter={tooltipMetricFormatter} />
              <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 11, color: "var(--chart-tick)" }} />
              {compareSeries.map((s, si) => {
                const slug = slugifyModelId(s.modelId);
                return (
                  <Bar
                    key={`${s.modelId}-ttft`}
                    xAxisId="ms"
                    dataKey={`${slug}_ttft`}
                    name={`${s.label || s.modelId} · TTFT`}
                    radius={[0, 2, 2, 0]}
                    fill={modelColor(si, "ttft")}
                  >
                    {rows.map((entry, i) => (
                      <Cell
                        key={`c-ttft-${i}`}
                        fill={
                          (entry[`__pass_${si}`] as number) === 0 ? "var(--chart-fail)" : modelColor(si, "ttft")
                        }
                      />
                    ))}
                  </Bar>
                );
              })}
              {compareSeries.map((s, si) => {
                const slug = slugifyModelId(s.modelId);
                return (
                  <Bar
                    key={`${s.modelId}-tpot`}
                    xAxisId="ms"
                    dataKey={`${slug}_tpot`}
                    name={`${s.label || s.modelId} · TPOT`}
                    radius={[0, 2, 2, 0]}
                    fill={modelColor(si, "tpot")}
                  >
                    {rows.map((entry, i) => (
                      <Cell
                        key={`c-tpot-${i}`}
                        fill={
                          (entry[`__pass_${si}`] as number) === 0 ? "var(--chart-fail)" : modelColor(si, "tpot")
                        }
                      />
                    ))}
                  </Bar>
                );
              })}
              {compareSeries.map((s, si) => {
                const slug = slugifyModelId(s.modelId);
                return (
                  <Bar
                    key={`${s.modelId}-tps`}
                    xAxisId="tps"
                    dataKey={`${slug}_tps`}
                    name={`${s.label || s.modelId} · TPS`}
                    radius={[0, 2, 2, 0]}
                    fill={modelColor(si, "tps")}
                  >
                    {rows.map((entry, i) => {
                      const tpsVal = Number(entry[`${slug}_tps`] ?? 0);
                      return (
                        <Cell
                          key={`c-tps-${i}`}
                          fill={
                            tpsVal <= 0
                              ? "transparent"
                              : (entry[`__pass_${si}`] as number) === 0
                                ? "var(--chart-fail)"
                                : modelColor(si, "tps")
                          }
                        />
                      );
                    })}
                  </Bar>
                );
              })}
              {avgTpsCompare !== undefined ? (
                <ReferenceLine
                  xAxisId="tps"
                  x={avgTpsCompare}
                  stroke="var(--chart-ref-line)"
                  strokeDasharray="3 3"
                  label={{ value: "avg TPS", fill: "var(--chart-tick)", fontSize: 9, position: "top" }}
                />
              ) : null}
            </BarChart>
          </ResponsiveContainer>
          <MetricChartLegend variant="compare" />
        </div>
        <div className="min-h-72">
          {pivoted.length >= 2 ? (
            <CompareRadar compareSeries={compareSeries} pivoted={pivoted} />
          ) : (
            <p className="flex h-64 items-center justify-center text-sm text-[var(--muted)]">
              비교 레이더는 시나리오가 2개 이상일 때 표시됩니다.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!chartRows.length) {
    return (
      <p className="flex h-64 items-center justify-center text-sm text-[var(--muted)]">벤치 실행 후 메트릭이 표시됩니다.</p>
    );
  }

  const ttfts = chartRows.map((r) => r.ttft).filter((n) => n > 0);
  const tpots = chartRows.map((r) => r.tpot).filter((n) => n > 0);
  const tpss = chartRows.map((r) => r.tps).filter((n) => n > 0);
  const avgTtft = avg(ttfts);
  const avgTpot = avg(tpots);
  const avgTps = avg(tpss);
  const radarData = buildRadarByScenario(chartRows);
  const barHeight = Math.min(560, Math.max(420, chartRows.length * 40));

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div style={{ minHeight: barHeight }}>
        <ResponsiveContainer width="100%" height={barHeight}>
          <BarChart
            layout="vertical"
            data={chartRows}
            margin={{ top: 36, right: 16, left: 8, bottom: 28 }}
            onClick={(e) => {
              const raw = e?.activePayload?.[0]?.payload as ChartRow | undefined;
              if (raw?.scenario && onBarPayload) onBarPayload(raw);
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
            <XAxis xAxisId="ms" type="number" tick={{ fill: "var(--chart-tick)", fontSize: 10 }} />
            <XAxis
              xAxisId="tps"
              type="number"
              orientation="top"
              tick={{ fill: "var(--chart-tick)", fontSize: 9 }}
              axisLine={{ stroke: "var(--chart-grid)" }}
              tickLine={{ stroke: "var(--chart-grid)" }}
              label={{ value: "tok/s", position: "insideTopRight", fill: "var(--chart-tick)", fontSize: 10 }}
            />
            <YAxis
              type="category"
              dataKey="fullLabel"
              width={248}
              tick={{ fill: "var(--chart-tick)", fontSize: 10 }}
              interval={0}
            />
            <Tooltip
              {...rechartsTooltipShell}
              formatter={tooltipMetricFormatter}
              labelFormatter={(_, i) => {
                const r = chartRows[Number(i)];
                return r ? `${r.scenario} · ${r.api}` : "";
              }}
            />
            <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 11, color: "var(--chart-tick)" }} />
            {avgTtft !== undefined ? (
              <ReferenceLine
                xAxisId="ms"
                x={avgTtft}
                stroke="var(--chart-ref-line)"
                strokeDasharray="4 4"
                label={{ value: "avg TTFT", fill: "var(--chart-tick)", fontSize: 10, position: "top" }}
              />
            ) : null}
            {avgTpot !== undefined ? (
              <ReferenceLine
                xAxisId="ms"
                x={avgTpot}
                stroke="var(--chart-ref-line)"
                strokeDasharray="2 6"
                label={{ value: "avg TPOT", fill: "var(--chart-tick)", fontSize: 10, position: "bottom" }}
              />
            ) : null}
            {avgTps !== undefined ? (
              <ReferenceLine
                xAxisId="tps"
                x={avgTps}
                stroke="var(--chart-ref-line)"
                strokeDasharray="3 3"
                label={{ value: "avg TPS", fill: "var(--chart-tick)", fontSize: 9, position: "top" }}
              />
            ) : null}
            <Bar xAxisId="ms" dataKey="ttft" name="TTFT (ms)" fill="var(--chart-ttft)" radius={[0, 2, 2, 0]}>
              {chartRows.map((entry) => (
                <Cell key={`ttft-${entry.id}`} fill={barFill(entry.pass, "ttft")} />
              ))}
            </Bar>
            <Bar xAxisId="ms" dataKey="tpot" name="TPOT (ms)" fill="var(--chart-tpot)" radius={[0, 2, 2, 0]}>
              {chartRows.map((entry) => (
                <Cell key={`tpot-${entry.id}`} fill={barFill(entry.pass, "tpot")} />
              ))}
            </Bar>
            <Bar xAxisId="tps" dataKey="tps" name="TPS (tok/s)" fill="var(--chart-tps)" radius={[0, 2, 2, 0]}>
              {chartRows.map((entry) => (
                <Cell
                  key={`tps-${entry.id}`}
                  fill={entry.tps > 0 ? barFill(entry.pass, "tps") : "transparent"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <MetricChartLegend variant="session" />
        {onBarPayload ? (
          <p className="mt-1 text-center text-xs text-[var(--muted)]">막대를 클릭하면 해당 시나리오 상세를 엽니다.</p>
        ) : null}
      </div>
      <div className="min-h-72">
        {radarData.length >= 2 ? (
          <ResponsiveContainer width="100%" height={420}>
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="72%">
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
              <Tooltip {...rechartsTooltipShell} formatter={(v: number) => [`${v} / 100`, "정규화 TTFT"]} />
              <Legend wrapperStyle={{ color: "var(--chart-tick)", fontSize: 11 }} />
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

function CompareRadar({
  compareSeries,
  pivoted,
}: {
  compareSeries: CompareSeries[];
  pivoted: ReturnType<typeof pivotCompareSeries>;
}) {
  const maxByScenario = new Map<string, number>();
  for (const p of pivoted) {
    let max = 1;
    for (const s of compareSeries) {
      const v = p.byModel[s.modelId];
      if (v && v.ttft > 0) max = Math.max(max, v.ttft);
    }
    maxByScenario.set(`${p.scenario}\t${p.api}`, max);
  }

  const radarRows = pivoted.map((p) => {
    const k = `${p.scenario}\t${p.api}`;
    const maxMs = maxByScenario.get(k) ?? 1;
    const o: Record<string, string | number> = { subject: p.label.slice(0, 16) + (p.label.length > 16 ? "…" : "") };
    compareSeries.forEach((s, i) => {
      const v = p.byModel[s.modelId];
      const ttft = v?.ttft ?? 0;
      o[`m${i}`] = ttft > 0 ? Math.round((ttft / maxMs) * 100) : 0;
    });
    return o;
  });

  return (
    <ResponsiveContainer width="100%" height={420}>
      <RadarChart data={radarRows} cx="50%" cy="50%" outerRadius="70%">
        <PolarGrid stroke="var(--chart-grid)" />
        <PolarAngleAxis dataKey="subject" tick={{ fill: "var(--chart-tick)", fontSize: 10 }} />
        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "var(--chart-tick)", fontSize: 9 }} />
        <Tooltip {...rechartsTooltipShell} formatter={(v: number, name: string) => [`${v} / 100`, name]} />
        <Legend wrapperStyle={{ color: "var(--chart-tick)", fontSize: 11 }} />
        {compareSeries.map((s, i) => (
          <Radar
            key={s.modelId}
            name={s.label || s.modelId}
            dataKey={`m${i}`}
            stroke={modelColor(i, "ttft")}
            fill={modelColor(i, "ttft")}
            fillOpacity={0.2}
          />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  );
}
