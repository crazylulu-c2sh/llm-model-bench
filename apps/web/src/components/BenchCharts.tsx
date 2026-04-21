import { useMemo } from "react";
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
import {
  apiRouteRank,
  apiShort,
  avg,
  compareSeriesHaveIdenticalScenarioApiKeys,
  percentile95Cap,
  pivotCompareSeries,
  sessionChartRowsToCompareSeries,
  type ChartRow,
  type CompareSeries,
  type PivotCompareRow,
} from "./chart-types";
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

type RadarMetric = "ttft" | "tpot" | "tps";

type SingleRadarDatum = {
  axisKey: string;
  tickLabel: string;
  fullLabel: string;
  rawValue: number;
  score: number;
};

function metricRaw(row: ChartRow, metric: RadarMetric): number {
  if (metric === "ttft") return row.ttft;
  if (metric === "tpot") return row.tpot;
  return row.tps;
}

function rawToRadarScore(raw: number, cap: number, metric: RadarMetric): number {
  if (raw <= 0) return 0;
  const normalized = Math.min(1, raw / Math.max(1, cap));
  if (metric === "tps") return Math.round(100 * normalized);
  return Math.round(100 * (1 - normalized));
}

/** 시나리오·API 키 목록(세 레이더 축 공통) — 피벗과 동일하게 시나리오·API 순으로 정렬. */
function scenarioApiKeyOrder(rows: ChartRow[]): string[] {
  const meta = new Map<string, { scenario: string; api: string }>();
  for (const r of rows) {
    const k = `${r.scenario}\t${r.api}`;
    if (!meta.has(k)) meta.set(k, { scenario: r.scenario, api: r.api });
  }
  return [...meta.keys()].sort((ka, kb) => {
    const a = meta.get(ka)!;
    const b = meta.get(kb)!;
    if (a.scenario !== b.scenario) return a.scenario.localeCompare(b.scenario);
    const d = apiRouteRank(a.api) - apiRouteRank(b.api);
    if (d !== 0) return d;
    return a.api.localeCompare(b.api);
  });
}

/** 단일 시리즈(한 모델): 축은 전체 시나리오·API와 동일, 값은 메트릭별 평균(없으면 0). p95 캡 분모, 점수는 바깥이 유리. */
function buildSingleRadarData(rows: ChartRow[], metric: RadarMetric): SingleRadarDatum[] {
  const keys = scenarioApiKeyOrder(rows);
  const sums = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const k = `${r.scenario}\t${r.api}`;
    const raw = metricRaw(r, metric);
    if (raw <= 0) continue;
    const cur = sums.get(k) ?? { sum: 0, n: 0 };
    cur.sum += raw;
    cur.n += 1;
    sums.set(k, cur);
  }
  const entries = keys.map((k) => {
    const agg = sums.get(k);
    const rawValue = agg && agg.n ? agg.sum / agg.n : 0;
    const [scenario, api] = k.split("\t");
    const fullLabel = `${scenario} (${apiShort(api)})`;
    const tickLabel = fullLabel.length > 28 ? `${fullLabel.slice(0, 26)}…` : fullLabel;
    return { axisKey: k, tickLabel, fullLabel, rawValue };
  });
  const positives = entries.map((e) => e.rawValue).filter((x) => x > 0);
  const cap = percentile95Cap(positives.length ? positives : [1]);
  return entries.map((e) => ({ ...e, score: rawToRadarScore(e.rawValue, cap, metric) }));
}

function pickPivotMetric(
  v: { ttft: number; tpot: number; tps: number } | undefined,
  metric: RadarMetric,
): number {
  if (!v) return 0;
  return metric === "ttft" ? v.ttft : metric === "tpot" ? v.tpot : v.tps;
}

/** 다중 시리즈: 비교에 표시된 모든 모델·축 기준 전역 p95 캡으로 0~100 상대점수(바깥이 유리). */
function buildCompareRadarRows(
  pivoted: PivotCompareRow[],
  compareSeries: CompareSeries[],
  metric: RadarMetric,
): Record<string, string | number>[] {
  const positives: number[] = [];
  for (const p of pivoted) {
    for (let i = 0; i < compareSeries.length; i++) {
      const raw = pickPivotMetric(p.bySeriesIndex[i], metric);
      if (raw > 0) positives.push(raw);
    }
  }
  const cap = percentile95Cap(positives.length ? positives : [1]);

  return pivoted.map((p) => {
    const axisKey = `${p.scenario}\t${p.api}`;
    const fullLabel = `${p.scenario} (${apiShort(p.api)})`;
    const tickLabel = fullLabel.length > 28 ? `${fullLabel.slice(0, 26)}…` : fullLabel;
    const raws = compareSeries.map((_, i) => pickPivotMetric(p.bySeriesIndex[i], metric));
    const o: Record<string, string | number> = { axisKey, tickLabel, fullLabel };
    compareSeries.forEach((_s, i) => {
      o[`raw_m${i}`] = raws[i] ?? 0;
      o[`m${i}`] = rawToRadarScore(raws[i] ?? 0, cap, metric);
    });
    return o;
  });
}

function radarRadiusDomain(data: Record<string, unknown>[], valueKeys: string[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of data) {
    for (const k of valueKeys) {
      const n = Number(row[k]);
      if (Number.isFinite(n)) {
        lo = Math.min(lo, n);
        hi = Math.max(hi, n);
      }
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 100];
  const span = hi - lo;
  const pad = span > 0 ? Math.max(4, span * 0.12) : 8;
  return [Math.max(0, lo - pad), Math.min(100, hi + pad)];
}

function hasAnyPositiveMetric(rows: ChartRow[], metric: RadarMetric): boolean {
  for (const r of rows) {
    if (metricRaw(r, metric) > 0) return true;
  }
  return false;
}

function hasAnyPositiveMetricPivot(pivoted: PivotCompareRow[], metric: RadarMetric): boolean {
  for (const p of pivoted) {
    for (const v of p.bySeriesIndex) {
      if (pickPivotMetric(v, metric) > 0) return true;
    }
  }
  return false;
}

const RADAR_DENSE_THRESHOLD = 10;
/** 각 레이더 차트 범례 높이(px) — ResponsiveContainer height에 포함 */
const RADAR_LEGEND_HEIGHT_PX = 28;

function perRadarChartHeight(axisCount: number): number {
  const bump = axisCount > RADAR_DENSE_THRESHOLD ? 24 : 0;
  return Math.min(320, Math.max(232, 244 + bump + Math.floor(axisCount / 7) * 6));
}

function formatRadarRaw(metric: RadarMetric, raw: number): string {
  if (metric === "tps") return `${Math.round(raw * 10) / 10} tok/s`;
  return `${Math.round(raw)} ms`;
}

function SingleRadarTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: { payload: SingleRadarDatum }[];
  metric: RadarMetric;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded border px-2 py-1.5 text-xs shadow-sm"
      style={{
        background: "var(--chart-tooltip-bg)",
        borderColor: "var(--chart-tooltip-border)",
        color: "var(--chart-tooltip-fg)",
      }}
    >
      <div style={{ color: "var(--chart-tooltip-label)", fontWeight: 500, marginBottom: 4 }}>{p.fullLabel}</div>
      <div>
        {formatRadarRaw(metric, p.rawValue)} · 비교 {p.score}/100
      </div>
    </div>
  );
}

function CompareRadarTooltip({
  active,
  payload,
  metric,
  compareSeries,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number; name?: string; color?: string }[];
  metric: RadarMetric;
  compareSeries: CompareSeries[];
}) {
  if (!active || !payload?.length) return null;
  const row = (payload[0] as { payload?: Record<string, unknown> }).payload;
  if (!row) return null;
  const full = String(row.fullLabel ?? "");
  return (
    <div
      className="rounded border px-2 py-1.5 text-xs shadow-sm"
      style={{
        background: "var(--chart-tooltip-bg)",
        borderColor: "var(--chart-tooltip-border)",
        color: "var(--chart-tooltip-fg)",
      }}
    >
      <div style={{ color: "var(--chart-tooltip-label)", fontWeight: 500, marginBottom: 4 }}>{full}</div>
      <ul className="space-y-0.5">
        {payload.map((item, i) => {
          const dk = String(item.dataKey ?? "");
          const mi = dk.match(/^m(\d+)$/);
          const idx = mi ? Number(mi[1]) : i;
          const raw = Number(row[`raw_m${idx}`] ?? 0);
          const label = compareSeries[idx]?.label || compareSeries[idx]?.modelId || `model_${idx}`;
          return (
            <li key={`${dk}-${i}`} style={{ color: "var(--chart-tooltip-fg)" }}>
              <span style={{ color: item.color }}>{label}</span>: {formatRadarRaw(metric, raw)} · 비교{" "}
              {item.value ?? "—"}/100
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MetricRadarSingle({
  title,
  subtitle,
  metric,
  data,
  height,
}: {
  title: string;
  subtitle: string;
  metric: RadarMetric;
  data: SingleRadarDatum[];
  height: number;
}) {
  const stroke =
    metric === "ttft" ? "var(--chart-ttft)" : metric === "tpot" ? "var(--chart-tpot)" : "var(--chart-tps)";
  const tickFmt = useMemo(() => new Map(data.map((d) => [d.axisKey, d.tickLabel])), [data]);
  const domain = useMemo(
    () => radarRadiusDomain(data as unknown as Record<string, unknown>[], ["score"]),
    [data],
  );
  const legendName =
    metric === "ttft" ? "TTFT 상대점수" : metric === "tpot" ? "TPOT 상대점수" : "TPS 상대점수";

  return (
    <div className="min-w-0">
      <h3 className="mb-0.5 text-xs font-semibold text-[var(--foreground)]">{title}</h3>
      <p className="mb-1 text-[10px] leading-snug text-[var(--muted)]">{subtitle}</p>
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart
          data={data}
          cx="50%"
          cy="50%"
          innerRadius="14%"
          outerRadius="68%"
          margin={{ top: 6, right: 20, bottom: 4, left: 20 }}
        >
          <PolarGrid stroke="var(--chart-grid)" />
          <PolarAngleAxis
            dataKey="axisKey"
            tick={{ fill: "var(--chart-tick)", fontSize: 9 }}
            tickFormatter={(v) => tickFmt.get(String(v)) ?? String(v)}
          />
          <PolarRadiusAxis angle={30} domain={domain} tick={{ fill: "var(--chart-tick)", fontSize: 8 }} />
          <Radar
            name={legendName}
            dataKey="score"
            stroke={stroke}
            fill={stroke}
            fillOpacity={0.35}
            strokeWidth={2}
            isAnimationActive={false}
            dot={{ r: 2, fillOpacity: 1 }}
          />
          <Tooltip content={<SingleRadarTooltip metric={metric} />} />
          <Legend
            verticalAlign="bottom"
            height={RADAR_LEGEND_HEIGHT_PX}
            wrapperStyle={{ fontSize: 10, color: "var(--chart-tick)" }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MetricRadarCompare({
  title,
  subtitle,
  metric,
  data,
  height,
  compareSeries,
}: {
  title: string;
  subtitle: string;
  metric: RadarMetric;
  data: Record<string, string | number>[];
  height: number;
  compareSeries: CompareSeries[];
}) {
  const valueKeys = useMemo(() => compareSeries.map((_, i) => `m${i}`), [compareSeries]);
  const domain = useMemo(
    () => radarRadiusDomain(data as Record<string, unknown>[], valueKeys),
    [data, valueKeys],
  );
  const tickFmt = useMemo(() => new Map(data.map((d) => [String(d.axisKey), String(d.tickLabel)])), [data]);

  return (
    <div className="min-w-0">
      <h3 className="mb-0.5 text-xs font-semibold text-[var(--foreground)]">{title}</h3>
      <p className="mb-1 text-[10px] leading-snug text-[var(--muted)]">{subtitle}</p>
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart
          data={data}
          cx="50%"
          cy="50%"
          innerRadius="14%"
          outerRadius="66%"
          margin={{ top: 6, right: 20, bottom: 4, left: 20 }}
        >
          <PolarGrid stroke="var(--chart-grid)" />
          <PolarAngleAxis
            dataKey="axisKey"
            tick={{ fill: "var(--chart-tick)", fontSize: 9 }}
            tickFormatter={(v) => tickFmt.get(String(v)) ?? String(v)}
          />
          <PolarRadiusAxis angle={30} domain={domain} tick={{ fill: "var(--chart-tick)", fontSize: 8 }} />
          <Tooltip content={<CompareRadarTooltip metric={metric} compareSeries={compareSeries} />} />
          <Legend
            verticalAlign="bottom"
            height={RADAR_LEGEND_HEIGHT_PX}
            wrapperStyle={{ fontSize: 10, color: "var(--chart-tick)" }}
          />
          {compareSeries.map((s, i) => (
            <Radar
              key={`radar-${metric}-${i}-${s.modelId || "unknown"}`}
              name={s.label || s.modelId || `model_${i}`}
              dataKey={`m${i}`}
              stroke={modelColor(i, metric)}
              fill={modelColor(i, metric)}
              fillOpacity={0.18}
              strokeWidth={2.5}
              isAnimationActive={false}
              dot={{ r: 2.5, fillOpacity: 1, strokeWidth: 1, stroke: "var(--surface)" }}
            />
          ))}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RadarPanelsColumn({
  axisCount,
  compareSeries,
  singleRows,
  pivoted,
  mode,
}: {
  axisCount: number;
  compareSeries: CompareSeries[];
  singleRows: ChartRow[] | null;
  pivoted: PivotCompareRow[];
  mode: "compare" | "single";
}) {
  const h = perRadarChartHeight(axisCount) + RADAR_LEGEND_HEIGHT_PX;
  const dense = axisCount >= RADAR_DENSE_THRESHOLD;

  const ttftCmp = useMemo(
    () => (mode === "compare" ? buildCompareRadarRows(pivoted, compareSeries, "ttft") : []),
    [mode, pivoted, compareSeries],
  );
  const tpotCmp = useMemo(
    () => (mode === "compare" ? buildCompareRadarRows(pivoted, compareSeries, "tpot") : []),
    [mode, pivoted, compareSeries],
  );
  const tpsCmp = useMemo(
    () => (mode === "compare" ? buildCompareRadarRows(pivoted, compareSeries, "tps") : []),
    [mode, pivoted, compareSeries],
  );

  const ttftSingle = useMemo(
    () => (singleRows ? buildSingleRadarData(singleRows, "ttft") : []),
    [singleRows],
  );
  const tpotSingle = useMemo(
    () => (singleRows ? buildSingleRadarData(singleRows, "tpot") : []),
    [singleRows],
  );
  const tpsSingle = useMemo(
    () => (singleRows ? buildSingleRadarData(singleRows, "tps") : []),
    [singleRows],
  );

  const showTpsCompare = hasAnyPositiveMetricPivot(pivoted, "tps");
  const showTpsSingle = singleRows ? hasAnyPositiveMetric(singleRows, "tps") : false;

  const compareKeyMismatch =
    mode === "compare" && compareSeries.length >= 2 && !compareSeriesHaveIdenticalScenarioApiKeys(compareSeries);

  const subMs = "축은 시나리오·API. 반경은 해당 메트릭에서 빠를수록(지연) 또는 높을수록(TPS) 바깥이 유리합니다.";
  const subTps = "축은 시나리오·API. 반경은 TPS가 높을수록 바깥이 유리합니다.";
  const subCompare =
    "비교에 표시된 모든 모델의 해당 메트릭 값으로 p95 캡을 잡고, 축마다 동일 분모의 0~100 상대점수로 그립니다. 지연(ms)은 낮을수록, TPS는 높을수록 바깥이 유리합니다.";

  return (
    <div className="flex min-h-0 flex-col gap-5">
      {dense ? (
        <p className="text-xs leading-snug text-[var(--muted)]">
          항목이 많아 레이더는 요약용입니다. 정확한 값은 왼쪽 막대 차트를 사용하세요.
        </p>
      ) : null}
      {compareKeyMismatch ? (
        <p className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-xs leading-snug text-[var(--muted)]">
          모델마다 저장된 시나리오·API(chat/msg) 조합이 다릅니다. 한쪽만 값이 있는 축은 0으로 그려지며, 반원처럼
          갈라져 보일 수 있습니다. 같은 벤치 스위트로 최근 런을 맞추거나, 막대 차트로 전체를 확인하세요.
        </p>
      ) : null}

      {mode === "compare" ? (
        <>
          <MetricRadarCompare
            title="TTFT"
            subtitle={subCompare}
            metric="ttft"
            data={ttftCmp}
            height={h}
            compareSeries={compareSeries}
          />
          <MetricRadarCompare
            title="TPOT"
            subtitle={subCompare}
            metric="tpot"
            data={tpotCmp}
            height={h}
            compareSeries={compareSeries}
          />
          {showTpsCompare ? (
            <MetricRadarCompare
              title="TPS"
              subtitle={subCompare}
              metric="tps"
              data={tpsCmp}
              height={h}
              compareSeries={compareSeries}
            />
          ) : (
            <p className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-3 text-center text-xs text-[var(--muted)]">
              TPS 레이더: 표시할 TPS 값이 없습니다.
            </p>
          )}
        </>
      ) : (
        <>
          <MetricRadarSingle title="TTFT" subtitle={subMs} metric="ttft" data={ttftSingle} height={h} />
          <MetricRadarSingle title="TPOT" subtitle={subMs} metric="tpot" data={tpotSingle} height={h} />
          {showTpsSingle ? (
            <MetricRadarSingle title="TPS" subtitle={subTps} metric="tps" data={tpsSingle} height={h} />
          ) : (
            <p className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-3 text-center text-xs text-[var(--muted)]">
              TPS 레이더: 표시할 TPS 값이 없습니다.
            </p>
          )}
        </>
      )}
    </div>
  );
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

const BAR_CHART_MAX_PX = 3200;
/** Legend `height={…}` 과 동일 — ResponsiveContainer 높이에 포함해야 함 */
const BAR_CHART_LEGEND_HEIGHT_PX = 36;
/** 카테고리(Y축 한 행)당 플롯에 확보할 최소 픽셀(범례·마진 제외) */
const BAR_CATEGORY_MIN_PX = 48;
/** 소량 행일 때도 전체 차트가 지나치게 납작하지 않게 하는 하한 */
const BAR_CHART_MIN_TOTAL_PX = 320;

/** 라이브 막대: 상단 ReferenceLine·이중 X축 라벨 여유 */
const LIVE_BAR_MARGIN = { top: 52, right: 16, left: 8, bottom: 28 } as const;
/** 비교 막대: 동일 범례·기준선 구조 */
const COMPARE_BAR_MARGIN = { top: 52, right: 24, left: 8, bottom: 28 } as const;

/**
 * Recharts는 전달한 height 안에 margin + Legend를 모두 그린 뒤 남은 영역에 카테고리를 나눕니다.
 * `rowCount * BAR_CATEGORY_MIN_PX`만 플롯에 쓰이도록 전체 높이를 역산합니다.
 */
function computeVerticalBarChartHeight(rowCount: number, marginTop: number, marginBottom: number): number {
  const rows = Math.max(1, rowCount);
  const plotMin = rows * BAR_CATEGORY_MIN_PX;
  const total = marginTop + marginBottom + BAR_CHART_LEGEND_HEIGHT_PX + plotMin;
  return Math.min(BAR_CHART_MAX_PX, Math.max(BAR_CHART_MIN_TOTAL_PX, total));
}

export function BenchCharts({ chartRows, compareSeries, onBarPayload, onCompareCell }: BenchChartsProps) {
  const compareMode = compareSeries && compareSeries.length >= 2;
  const pivoted = compareMode ? pivotCompareSeries(compareSeries) : [];
  const compareChartHeight = compareMode
    ? computeVerticalBarChartHeight(pivoted.length, COMPARE_BAR_MARGIN.top, COMPARE_BAR_MARGIN.bottom)
    : 400;

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
        <div className="min-w-0 overflow-x-hidden">
          <ResponsiveContainer width="100%" height={compareChartHeight}>
            <BarChart
              layout="vertical"
              data={rows}
              margin={{ ...COMPARE_BAR_MARGIN }}
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
                width={248}
                tick={{ fill: "var(--chart-tick)", fontSize: 10 }}
                interval={0}
              />
              <Tooltip {...rechartsTooltipShell} formatter={tooltipMetricFormatter} />
              <Legend
                verticalAlign="bottom"
                height={BAR_CHART_LEGEND_HEIGHT_PX}
                wrapperStyle={{ fontSize: 11, color: "var(--chart-tick)" }}
              />
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
        <div className="min-h-72 min-w-0">
          {pivoted.length >= 2 ? (
            <RadarPanelsColumn
              axisCount={pivoted.length}
              compareSeries={compareSeries}
              singleRows={null}
              pivoted={pivoted}
              mode="compare"
            />
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
  const sessionSeries = sessionChartRowsToCompareSeries(chartRows);
  const useSessionMultiRadar = sessionSeries.length >= 2;
  const pivotedSession = useSessionMultiRadar ? pivotCompareSeries(sessionSeries) : [];
  const radarAxisCount = scenarioApiKeyOrder(chartRows).length;
  const barHeight = computeVerticalBarChartHeight(
    chartRows.length,
    LIVE_BAR_MARGIN.top,
    LIVE_BAR_MARGIN.bottom,
  );

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="min-w-0 overflow-x-hidden">
        <ResponsiveContainer width="100%" height={barHeight}>
          <BarChart
            layout="vertical"
            data={chartRows}
            margin={{ ...LIVE_BAR_MARGIN }}
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
            <Legend
              verticalAlign="bottom"
              height={BAR_CHART_LEGEND_HEIGHT_PX}
              wrapperStyle={{ fontSize: 11, color: "var(--chart-tick)" }}
            />
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
      <div className="min-h-72 min-w-0">
        {useSessionMultiRadar && pivotedSession.length >= 2 ? (
          <RadarPanelsColumn
            axisCount={pivotedSession.length}
            compareSeries={sessionSeries}
            singleRows={null}
            pivoted={pivotedSession}
            mode="compare"
          />
        ) : radarAxisCount >= 2 ? (
          <RadarPanelsColumn
            axisCount={radarAxisCount}
            compareSeries={[]}
            singleRows={chartRows}
            pivoted={[]}
            mode="single"
          />
        ) : useSessionMultiRadar ? (
          <p className="flex h-full min-h-64 items-center justify-center text-center text-sm text-[var(--muted)]">
            모델 간 레이더 비교는 시나리오가 2개 이상일 때 표시됩니다.
          </p>
        ) : (
          <p className="flex h-full min-h-64 items-center justify-center text-center text-sm text-[var(--muted)]">
            레이더 차트는 시나리오가 2개 이상일 때 표시됩니다.
          </p>
        )}
      </div>
    </div>
  );
}
