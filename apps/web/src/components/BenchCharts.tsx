import { compareStringsPinned } from "@llm-bench/shared";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  DefaultTooltipContent,
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
import type { TooltipValueType } from "recharts";
import {
  apiRouteRank,
  apiShort,
  avg,
  comparePivotToFlatBarData,
  compareScenarioExecutionOrder,
  compareSeriesHaveIdenticalScenarioApiKeys,
  pivotCompareSeries,
  sessionChartRowsToCompareSeries,
  type ChartRow,
  type CompareSeries,
  type FlatBarDatum,
  type PivotCompareRow,
} from "./chart-types";
import { MetricChartLegend } from "./MetricChartLegend";
import { niceCeil, rechartsTooltipShell } from "../lib/chart-theme";

function barFill(pass: boolean | undefined, kind: "ttft" | "tps"): string {
  if (pass === false) return "var(--chart-fail)";
  if (pass === true) {
    if (kind === "ttft") return "var(--chart-ttft)";
    return "var(--chart-tps)";
  }
  return "var(--chart-neutral)";
}

function modelColor(i: number, kind: "ttft" | "tps"): string {
  const hues = [200, 145, 280, 35, 12, 320];
  const h = hues[i % hues.length];
  const l = kind === "ttft" ? 55 : 62;
  return `hsl(${h} 70% ${l}%)`;
}

/** 비교 레이더 시리즈: 색 외 구분 단서용 대시 패턴("0"=실선) */
const RADAR_SERIES_DASH = ["0", "6 3", "2 2", "8 3 2 3", "4 4", "1 3"];

function tooltipMetricFormatter(
  value: TooltipValueType | undefined,
  name: number | string | undefined,
  item?: { payload?: { pass?: boolean } },
): [string, string] {
  // Recharts v3: value is ValueType|undefined (number|string|array), name is NameType|undefined.
  const n = String(name);
  const num = Number(value);
  const pass = item?.payload?.pass;
  const passText = pass === undefined ? "" : pass ? " · 통과" : " · 미통과";
  if (n.includes("TPS")) return [Number.isFinite(num) ? `${Math.round(num * 10) / 10} tok/s${passText}` : "—", n];
  return [`${Math.round(num)} ms${passText}`, n];
}

function yTickHideSpacer(label: string | number): string {
  return typeof label === "string" && label.startsWith("__spacer__") ? "" : String(label);
}

/** 비교: (시나리오·API) 피벗마다 `groupSize`행(모델 수) 뒤에 빈 카테고리 1개 */
function insertCompareGroupSpacers(rows: FlatBarDatum[], groupSize: number): FlatBarDatum[] {
  if (groupSize < 2 || rows.length === 0) return rows;
  const out: FlatBarDatum[] = [];
  let seq = 0;
  for (let i = 0; i < rows.length; i++) {
    out.push(rows[i]!);
    if ((i + 1) % groupSize === 0 && i + 1 < rows.length) {
      out.push({
        categorySpacer: true,
        barLabel: `__spacer__${seq++}`,
        scenario: "",
        api: "",
        modelId: undefined,
        seriesIndex: 0,
        ttft: 0,
        tps: 0,
        pass: undefined,
      });
    }
  }
  return out;
}

function sessionHasMultiModel(rows: ChartRow[]): boolean {
  return new Set(rows.map((r) => r.modelId ?? "_")).size >= 2;
}

/** 세션 멀티 모델: `(scenario,api)` 블록 사이에 빈 카테고리 1개 */
function insertSessionGroupSpacers(rows: ChartRow[], multiModel: boolean): ChartRow[] {
  if (!multiModel || rows.length === 0) return rows;
  const out: ChartRow[] = [];
  let seq = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    out.push(row);
    const next = rows[i + 1];
    if (!next) continue;
    const k = `${row.scenario}\t${row.api}`;
    const kn = `${next.scenario}\t${next.api}`;
    if (k !== kn) {
      const sid = seq++;
      out.push({
        id: `__category-spacer-${sid}`,
        labelShort: "",
        fullLabel: `__spacer__${sid}`,
        scenario: "",
        api: "",
        ttft: 0,
        tps: 0,
        categorySpacer: true,
      });
    }
  }
  return out;
}

type RadarMetric = "ttft" | "tps";

type SingleRadarDatum = {
  axisKey: string;
  tickLabel: string;
  fullLabel: string;
  rawValue: number;
};

function metricRaw(row: ChartRow, metric: RadarMetric): number {
  if (metric === "ttft") return row.ttft;
  return row.tps;
}

/** 시나리오·API 키 목록(세 레이더 축 공통) — 피벗과 동일하게 시나리오·API 순으로 정렬. */
function scenarioApiKeyOrder(rows: ChartRow[]): string[] {
  const meta = new Map<string, { scenario: string; api: string }>();
  for (const r of rows) {
    if (r.categorySpacer) continue;
    const k = `${r.scenario}\t${r.api}`;
    if (!meta.has(k)) meta.set(k, { scenario: r.scenario, api: r.api });
  }
  return [...meta.keys()].sort((ka, kb) => {
    const a = meta.get(ka)!;
    const b = meta.get(kb)!;
    const s = compareScenarioExecutionOrder(a.scenario, b.scenario);
    if (s !== 0) return s;
    const d = apiRouteRank(a.api) - apiRouteRank(b.api);
    if (d !== 0) return d;
    return compareStringsPinned(a.api, b.api);
  });
}

/** 단일 시리즈(한 모델): 축은 전체 시나리오·API와 동일, 값은 메트릭별 실제 평균(없으면 0)을 그대로 반경에 사용. */
function buildSingleRadarData(rows: ChartRow[], metric: RadarMetric): SingleRadarDatum[] {
  const keys = scenarioApiKeyOrder(rows);
  const sums = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (r.categorySpacer) continue;
    const k = `${r.scenario}\t${r.api}`;
    const raw = metricRaw(r, metric);
    if (raw <= 0) continue;
    const cur = sums.get(k) ?? { sum: 0, n: 0 };
    cur.sum += raw;
    cur.n += 1;
    sums.set(k, cur);
  }
  return keys.map((k) => {
    const agg = sums.get(k);
    const rawValue = agg && agg.n ? agg.sum / agg.n : 0;
    const [scenario, api] = k.split("\t");
    const fullLabel = `${scenario} (${apiShort(api)})`;
    const tickLabel = fullLabel.length > 28 ? `${fullLabel.slice(0, 26)}…` : fullLabel;
    return { axisKey: k, tickLabel, fullLabel, rawValue };
  });
}

function pickPivotMetric(
  v: { ttft: number; tps: number } | undefined,
  metric: RadarMetric,
): number {
  if (!v) return 0;
  return metric === "ttft" ? v.ttft : v.tps;
}

/** 다중 시리즈: 축마다 모델별 실제 측정치(raw_m{i})를 그대로 담는다. 반경 스케일은 도메인에서 0 기준 공통화. */
function buildCompareRadarRows(
  pivoted: PivotCompareRow[],
  compareSeries: CompareSeries[],
  metric: RadarMetric,
): Record<string, string | number>[] {
  return pivoted.map((p) => {
    const axisKey = `${p.scenario}\t${p.api}`;
    const fullLabel = `${p.scenario} (${apiShort(p.api)})`;
    const tickLabel = fullLabel.length > 28 ? `${fullLabel.slice(0, 26)}…` : fullLabel;
    const o: Record<string, string | number> = { axisKey, tickLabel, fullLabel };
    compareSeries.forEach((_s, i) => {
      o[`raw_m${i}`] = pickPivotMetric(p.bySeriesIndex[i], metric);
    });
    return o;
  });
}

/** raw 값 레이더 반경 도메인: 0 기준 [0, niceCeil(max)]. 면적이 값에 비례하고 막대 차트와 동일한 읽기. */
function radarRawDomain(data: Record<string, unknown>[], valueKeys: string[]): [number, number] {
  let hi = 0;
  for (const row of data) {
    for (const k of valueKeys) {
      const n = Number(row[k]);
      if (Number.isFinite(n) && n > hi) hi = n;
    }
  }
  return [0, hi > 0 ? niceCeil(hi) : 1];
}

function hasAnyPositiveMetric(rows: ChartRow[], metric: RadarMetric): boolean {
  for (const r of rows) {
    if (r.categorySpacer) continue;
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

/** 레이더 축(시나리오·API) 최소 개수 — 2축은 시각적으로 선분에 가까워 3부터 표시 */
const MIN_RADAR_AXIS_COUNT = 3;
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

/** 반경 축 눈금: 큰 ms는 'Nk'로 축약(작은 fontSize에서 겹침 방지), TPS·작은 값은 정수. */
function formatRadarTick(metric: RadarMetric, v: number): string {
  if (metric !== "tps" && v >= 1000) return `${Math.round(v / 100) / 10}k`;
  return String(Math.round(v));
}

function metricUnitLabel(metric: RadarMetric): string {
  return metric === "tps" ? "TPS(tok/s)" : "TTFT(ms)";
}

/**
 * 메트릭별 맞춤 레이더 설명 + '클수록/작을수록 우수' 방향 강조.
 * 작을수록 우수(지연)=주황(--dir-lower), 클수록 우수(TPS)=청록(--dir-higher)으로 색을 구별한다.
 */
function RadarSubtitle({ metric, scope }: { metric: RadarMetric; scope: "single" | "compare" }) {
  const unit = metricUnitLabel(metric);
  const higher = metric === "tps";
  const dirText = higher ? "클수록(바깥)이 우수" : "작을수록(안쪽)이 우수";
  const dirColor = higher ? "var(--dir-higher)" : "var(--dir-lower)";
  const lead =
    scope === "compare"
      ? `축은 시나리오·API. 반경은 모델별 실제 ${unit}를 0 기준 공통 스케일로 그립니다. `
      : `축은 시나리오·API. 반경은 실제 ${unit}를 0 기준 스케일로 그립니다. `;
  return (
    <p className="mb-1 text-[10px] leading-snug text-[var(--muted)]">
      {lead}
      <strong
        className="rounded px-1 py-px font-semibold"
        style={{ color: dirColor, background: `color-mix(in srgb, ${dirColor} 14%, transparent)` }}
      >
        {dirText}
      </strong>
    </p>
  );
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
      <div>{formatRadarRaw(metric, p.rawValue)}</div>
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
          const mi = dk.match(/^raw_m(\d+)$/);
          const idx = mi ? Number(mi[1]) : i;
          const raw = Number(row[`raw_m${idx}`] ?? 0);
          const label = compareSeries[idx]?.label || compareSeries[idx]?.modelId || `model_${idx}`;
          return (
            <li key={`${dk}-${i}`} style={{ color: "var(--chart-tooltip-fg)" }}>
              <span style={{ color: item.color }}>{label}</span>: {formatRadarRaw(metric, raw)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MetricRadarSingle({
  title,
  metric,
  data,
  height,
}: {
  title: string;
  metric: RadarMetric;
  data: SingleRadarDatum[];
  height: number;
}) {
  const stroke = metric === "tps" ? "var(--chart-tps)" : "var(--chart-ttft)";
  const tickFmt = useMemo(() => new Map(data.map((d) => [d.axisKey, d.tickLabel])), [data]);
  const domain = useMemo(
    () => radarRawDomain(data as unknown as Record<string, unknown>[], ["rawValue"]),
    [data],
  );
  const legendName =
    metric === "tps" ? "TPS (tok/s · 클수록 좋음)" : "TTFT (ms · 작을수록 좋음)";

  return (
    <div className="min-w-0">
      <h3 className="mb-0.5 text-xs font-semibold text-[var(--foreground)]">{title}</h3>
      <RadarSubtitle metric={metric} scope="single" />
      <div role="img" aria-label={`${title} 레이더 차트(축: 시나리오·API) — 정확한 값은 막대 차트와 표 참조`}>
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
            <PolarRadiusAxis
              angle={30}
              domain={domain}
              tickFormatter={(v) => formatRadarTick(metric, Number(v))}
              tick={{ fill: "var(--chart-tick)", fontSize: 8 }}
            />
            <Radar
              name={legendName}
              dataKey="rawValue"
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
    </div>
  );
}

function MetricRadarCompare({
  title,
  metric,
  data,
  height,
  compareSeries,
}: {
  title: string;
  metric: RadarMetric;
  data: Record<string, string | number>[];
  height: number;
  compareSeries: CompareSeries[];
}) {
  const valueKeys = useMemo(() => compareSeries.map((_, i) => `raw_m${i}`), [compareSeries]);
  const domain = useMemo(
    () => radarRawDomain(data as Record<string, unknown>[], valueKeys),
    [data, valueKeys],
  );
  const tickFmt = useMemo(() => new Map(data.map((d) => [String(d.axisKey), String(d.tickLabel)])), [data]);

  return (
    <div className="min-w-0">
      <h3 className="mb-0.5 text-xs font-semibold text-[var(--foreground)]">{title}</h3>
      <RadarSubtitle metric={metric} scope="compare" />
      <div
        role="img"
        aria-label={`${title} 모델 비교 레이더 차트(모델 ${compareSeries.length}개, 축: 시나리오·API) — 정확한 값은 막대 차트와 표 참조`}
      >
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
            <PolarRadiusAxis
              angle={30}
              domain={domain}
              tickFormatter={(v) => formatRadarTick(metric, Number(v))}
              tick={{ fill: "var(--chart-tick)", fontSize: 8 }}
            />
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
                dataKey={`raw_m${i}`}
                stroke={modelColor(i, metric)}
                strokeDasharray={RADAR_SERIES_DASH[i % RADAR_SERIES_DASH.length]}
                fill={modelColor(i, metric)}
                fillOpacity={0.18}
                strokeWidth={i % 2 === 0 ? 2.5 : 2}
                isAnimationActive={false}
                dot={{ r: 2.5, fillOpacity: 1, strokeWidth: 1, stroke: "var(--surface)" }}
              />
            ))}
          </RadarChart>
        </ResponsiveContainer>
      </div>
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
  const tpsCmp = useMemo(
    () => (mode === "compare" ? buildCompareRadarRows(pivoted, compareSeries, "tps") : []),
    [mode, pivoted, compareSeries],
  );

  const ttftSingle = useMemo(
    () => (singleRows ? buildSingleRadarData(singleRows, "ttft") : []),
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

  return (
    <div className="flex min-h-0 flex-col gap-5">
      {dense ? (
        <p className="text-xs leading-snug text-[var(--muted)]">
          항목이 많아 레이더는 요약용입니다. 정확한 값은 지표별 막대 차트를 사용하세요.
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
            metric="ttft"
            data={ttftCmp}
            height={h}
            compareSeries={compareSeries}
          />
          {showTpsCompare ? (
            <MetricRadarCompare
              title="TPS"
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
          <MetricRadarSingle title="TTFT" metric="ttft" data={ttftSingle} height={h} />
          {showTpsSingle ? (
            <MetricRadarSingle title="TPS" metric="tps" data={tpsSingle} height={h} />
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

type BenchChartsProps = {
  chartRows: ChartRow[];
  compareSeries?: CompareSeries[] | null;
  onBarPayload?: (row: ChartRow) => void;
  onCompareCell?: (scenario: string, api: string, modelId?: string) => void;
};

const BAR_CHART_MAX_PX = 3200;
/** Legend `height={…}` 과 동일 — ResponsiveContainer 높이에 포함해야 함 */
const BAR_CHART_LEGEND_HEIGHT_PX = 36;
/** 카테고리(Y축 한 행)당 플롯에 확보할 최소 픽셀 — 실행당 막대 1개(스택) 기준으로 촘촘히 */
const BAR_CATEGORY_MIN_PX = 16;
/** 소량 행일 때 차트 전체 높이 하한(막대 3개 시절 320px 대비 축소) */
const BAR_CHART_MIN_TOTAL_PX = 200;
/** Recharts 기본 barCategoryGap 10%는 행 사이 공백이 커서 1막대/행에 맞게 줄임 */
const BAR_COMPACT_GAP = { barCategoryGap: "2%" as const, barGap: 0 as const };

/** 라이브 막대: 상단 ReferenceLine·이중 X축 라벨 여유 */
const LIVE_BAR_MARGIN = { top: 52, right: 16, left: 8, bottom: 28 } as const;
/** 비교 막대: 동일 범례·기준선 구조 */
const COMPARE_BAR_MARGIN = { top: 52, right: 24, left: 8, bottom: 28 } as const;
/** TPS 전용 막대(비교): 기준선·축 라벨 여유 */
const TPS_COMPARE_BAR_MARGIN = { top: 44, right: 24, left: 8, bottom: 24 } as const;
/** TPS 전용 막대(세션) */
const TPS_SESSION_BAR_MARGIN = { top: 44, right: 16, left: 8, bottom: 24 } as const;

/**
 * Recharts는 전달한 height 안에 margin + Legend를 모두 그린 뒤 남은 영역에 카테고리를 나눕니다.
 * `rowCount * BAR_CATEGORY_MIN_PX`만 플롯에 쓰이도록 전체 높이를 역산합니다.
 */
function computeVerticalBarChartHeight(
  rowCount: number,
  marginTop: number,
  marginBottom: number,
  legendHeightPx: number = BAR_CHART_LEGEND_HEIGHT_PX,
): number {
  const rows = Math.max(1, rowCount);
  const plotMin = rows * BAR_CATEGORY_MIN_PX;
  const total = marginTop + marginBottom + legendHeightPx + plotMin;
  return Math.min(BAR_CHART_MAX_PX, Math.max(BAR_CHART_MIN_TOTAL_PX, total));
}

export function BenchCharts({ chartRows, compareSeries, onBarPayload, onCompareCell }: BenchChartsProps) {
  const compareMode = compareSeries && compareSeries.length >= 2;
  const pivoted = compareMode ? pivotCompareSeries(compareSeries) : [];

  if (compareMode && compareSeries) {
    const flatRows = comparePivotToFlatBarData(pivoted, compareSeries);
    const flatRowsSpaced = insertCompareGroupSpacers(flatRows, compareSeries.length);
    const compareLatencyHeight = computeVerticalBarChartHeight(
      flatRowsSpaced.length,
      COMPARE_BAR_MARGIN.top,
      COMPARE_BAR_MARGIN.bottom,
      0,
    );
    const compareTpsHeight = computeVerticalBarChartHeight(
      flatRowsSpaced.length,
      TPS_COMPARE_BAR_MARGIN.top,
      TPS_COMPARE_BAR_MARGIN.bottom,
      0,
    );

    const ttftsCmp = flatRows.map((r) => r.ttft).filter((n) => n > 0);
    const tpssCmp = flatRows.map((r) => r.tps).filter((n) => n > 0);
    const avgTtftCmp = avg(ttftsCmp);
    const avgTpsCmp = avg(tpssCmp);

    const fireCompareClick = (payload: FlatBarDatum | undefined) => {
      if (payload?.categorySpacer) return;
      if (payload?.scenario && payload?.api) {
        onCompareCell?.(payload.scenario, payload.api, payload.modelId);
      }
    };

    return (
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2 overflow-x-hidden">
          <div role="img" aria-label={`TTFT 모델 비교 막대 차트(모델 ${compareSeries.length}개) — 자세한 값은 아래 결과 표 참조`}>
            <ResponsiveContainer width="100%" height={compareLatencyHeight}>
              <BarChart
                layout="vertical"
                {...BAR_COMPACT_GAP}
                data={flatRowsSpaced}
                margin={{ ...COMPARE_BAR_MARGIN }}
                onClick={(e) => {
                  // Recharts v3: no activePayload on click param — resolve row from data via activeIndex.
                  const idx = e?.activeIndex;
                  fireCompareClick(typeof idx === "number" ? flatRowsSpaced[idx] : undefined);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                <XAxis type="number" tick={{ fill: "var(--chart-tick)", fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="barLabel"
                  width={280}
                  tick={{ fill: "var(--chart-tick)", fontSize: 10 }}
                  tickFormatter={yTickHideSpacer}
                  interval={0}
                />
                <Tooltip
                  {...rechartsTooltipShell}
                  formatter={tooltipMetricFormatter}
                  content={(props) => {
                    if (!props.active || !props.payload?.[0]) return null;
                    const row = props.payload[0].payload as FlatBarDatum;
                    if (row.categorySpacer) return null;
                    return <DefaultTooltipContent {...props} formatter={tooltipMetricFormatter} />;
                  }}
                />
                {avgTtftCmp !== undefined ? (
                  <ReferenceLine
                    x={avgTtftCmp}
                    stroke="var(--chart-ref-line)"
                    strokeDasharray="4 4"
                    label={{ value: "avg TTFT", fill: "var(--chart-tick)", fontSize: 10, position: "top" }}
                  />
                ) : null}
                <Bar
                  stackId="latency"
                  dataKey="ttft"
                  name="TTFT (ms)"
                  fill="var(--chart-ttft)"
                  radius={[0, 2, 2, 0]}
                >
                  {flatRowsSpaced.map((entry, i) => {
                    const fail = !entry.categorySpacer && entry.pass === false;
                    return (
                      <Cell
                        key={`cmp-ttft-${i}`}
                        fill={entry.categorySpacer ? "transparent" : barFill(entry.pass, "ttft")}
                        fillOpacity={fail ? 0.55 : 1}
                        stroke={fail ? "var(--chart-fail)" : undefined}
                        strokeDasharray={fail ? "4 2" : undefined}
                        strokeWidth={fail ? 1.5 : 0}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div role="img" aria-label={`TPS 모델 비교 막대 차트(모델 ${compareSeries.length}개) — 자세한 값은 아래 결과 표 참조`}>
            <ResponsiveContainer width="100%" height={compareTpsHeight}>
              <BarChart
                layout="vertical"
                {...BAR_COMPACT_GAP}
                data={flatRowsSpaced}
                margin={{ ...TPS_COMPARE_BAR_MARGIN }}
                onClick={(e) => {
                  // Recharts v3: no activePayload on click param — resolve row from data via activeIndex.
                  const idx = e?.activeIndex;
                  fireCompareClick(typeof idx === "number" ? flatRowsSpaced[idx] : undefined);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: "var(--chart-tick)", fontSize: 9 }}
                  label={{ value: "tok/s", position: "insideBottomRight", fill: "var(--chart-tick)", fontSize: 10 }}
                />
                <YAxis
                  type="category"
                  dataKey="barLabel"
                  width={280}
                  tick={{ fill: "var(--chart-tick)", fontSize: 10 }}
                  tickFormatter={yTickHideSpacer}
                  interval={0}
                />
                <Tooltip
                  {...rechartsTooltipShell}
                  formatter={tooltipMetricFormatter}
                  content={(props) => {
                    if (!props.active || !props.payload?.[0]) return null;
                    const row = props.payload[0].payload as FlatBarDatum;
                    if (row.categorySpacer) return null;
                    return <DefaultTooltipContent {...props} formatter={tooltipMetricFormatter} />;
                  }}
                />
                {avgTpsCmp !== undefined ? (
                  <ReferenceLine
                    x={avgTpsCmp}
                    stroke="var(--chart-ref-line)"
                    strokeDasharray="3 3"
                    label={{ value: "avg TPS", fill: "var(--chart-tick)", fontSize: 9, position: "top" }}
                  />
                ) : null}
                <Bar dataKey="tps" name="TPS (tok/s)" fill="var(--chart-tps)" radius={[0, 2, 2, 0]}>
                  {flatRowsSpaced.map((entry, i) => {
                    if (entry.categorySpacer) {
                      return <Cell key={`cmp-tps-${i}`} fill="transparent" />;
                    }
                    const tpsVal = entry.tps;
                    const fill =
                      tpsVal <= 0
                        ? "transparent"
                        : entry.pass === false
                          ? "var(--chart-fail)"
                          : modelColor(entry.seriesIndex, "tps");
                    const fail = tpsVal > 0 && entry.pass === false;
                    return (
                      <Cell
                        key={`cmp-tps-${i}`}
                        fill={fill}
                        fillOpacity={fail ? 0.55 : 1}
                        stroke={fail ? "var(--chart-fail)" : undefined}
                        strokeDasharray={fail ? "4 2" : undefined}
                        strokeWidth={fail ? 1.5 : 0}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <MetricChartLegend variant="compare" />
        </div>
        <div className="min-h-72 min-w-0">
          {pivoted.length >= MIN_RADAR_AXIS_COUNT ? (
            <RadarPanelsColumn
              axisCount={pivoted.length}
              compareSeries={compareSeries}
              singleRows={null}
              pivoted={pivoted}
              mode="compare"
            />
          ) : (
            <p className="flex h-64 items-center justify-center text-sm text-[var(--muted)]">
              비교 레이더는 시나리오가 3개 이상일 때 표시됩니다.
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
  const tpss = chartRows.map((r) => r.tps).filter((n) => n > 0);
  const avgTtft = avg(ttfts);
  const avgTps = avg(tpss);
  const sessionSeries = sessionChartRowsToCompareSeries(chartRows);
  const useSessionMultiRadar = sessionSeries.length >= 2;
  const pivotedSession = useSessionMultiRadar ? pivotCompareSeries(sessionSeries) : [];
  const radarAxisCount = scenarioApiKeyOrder(chartRows).length;
  const sessionMulti = sessionHasMultiModel(chartRows);
  const sessionBarData = insertSessionGroupSpacers(chartRows, sessionMulti);
  const sessionLatencyHeight = computeVerticalBarChartHeight(
    sessionBarData.length,
    LIVE_BAR_MARGIN.top,
    LIVE_BAR_MARGIN.bottom,
    0,
  );
  const sessionTpsHeight = computeVerticalBarChartHeight(
    sessionBarData.length,
    TPS_SESSION_BAR_MARGIN.top,
    TPS_SESSION_BAR_MARGIN.bottom,
    0,
  );

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2 overflow-x-hidden">
        <div role="img" aria-label="TTFT 시나리오별 막대 차트 — 자세한 값은 아래 결과 표 참조">
          <ResponsiveContainer width="100%" height={sessionLatencyHeight}>
            <BarChart
              layout="vertical"
              {...BAR_COMPACT_GAP}
              data={sessionBarData}
              margin={{ ...LIVE_BAR_MARGIN }}
              onClick={(e) => {
                // Recharts v3: no activePayload on click param — resolve row from data via activeIndex.
                const idx = e?.activeIndex;
                const raw = typeof idx === "number" ? sessionBarData[idx] : undefined;
                if (raw?.categorySpacer) return;
                if (raw?.scenario && onBarPayload) onBarPayload(raw);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
              <XAxis type="number" tick={{ fill: "var(--chart-tick)", fontSize: 10 }} />
              <YAxis
                type="category"
                dataKey="fullLabel"
                width={280}
                tick={{ fill: "var(--chart-tick)", fontSize: 10 }}
                tickFormatter={yTickHideSpacer}
                interval={0}
              />
              <Tooltip
                {...rechartsTooltipShell}
                formatter={tooltipMetricFormatter}
                content={(props) => {
                  if (!props.active || !props.payload?.[0]) return null;
                  const row = props.payload[0].payload as ChartRow;
                  if (row.categorySpacer) return null;
                  return <DefaultTooltipContent {...props} formatter={tooltipMetricFormatter} />;
                }}
                labelFormatter={(_, i) => {
                  const r = sessionBarData[Number(i)];
                  if (!r || r.categorySpacer) return "";
                  return `${r.scenario} · ${r.api}`;
                }}
              />
              {avgTtft !== undefined ? (
                <ReferenceLine
                  x={avgTtft}
                  stroke="var(--chart-ref-line)"
                  strokeDasharray="4 4"
                  label={{ value: "avg TTFT", fill: "var(--chart-tick)", fontSize: 10, position: "top" }}
                />
              ) : null}
              <Bar
                stackId="latency"
                dataKey="ttft"
                name="TTFT (ms)"
                fill="var(--chart-ttft)"
                radius={[0, 2, 2, 0]}
              >
                {sessionBarData.map((entry) => {
                  const fail = !entry.categorySpacer && entry.pass === false;
                  return (
                    <Cell
                      key={`ttft-${entry.id}`}
                      fill={entry.categorySpacer ? "transparent" : barFill(entry.pass, "ttft")}
                      fillOpacity={fail ? 0.55 : 1}
                      stroke={fail ? "var(--chart-fail)" : undefined}
                      strokeDasharray={fail ? "4 2" : undefined}
                      strokeWidth={fail ? 1.5 : 0}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div role="img" aria-label="TPS 시나리오별 막대 차트 — 자세한 값은 아래 결과 표 참조">
          <ResponsiveContainer width="100%" height={sessionTpsHeight}>
            <BarChart
              layout="vertical"
              {...BAR_COMPACT_GAP}
              data={sessionBarData}
              margin={{ ...TPS_SESSION_BAR_MARGIN }}
              onClick={(e) => {
                // Recharts v3: no activePayload on click param — resolve row from data via activeIndex.
                const idx = e?.activeIndex;
                const raw = typeof idx === "number" ? sessionBarData[idx] : undefined;
                if (raw?.categorySpacer) return;
                if (raw?.scenario && onBarPayload) onBarPayload(raw);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: "var(--chart-tick)", fontSize: 9 }}
                label={{ value: "tok/s", position: "insideBottomRight", fill: "var(--chart-tick)", fontSize: 10 }}
              />
              <YAxis
                type="category"
                dataKey="fullLabel"
                width={280}
                tick={{ fill: "var(--chart-tick)", fontSize: 10 }}
                tickFormatter={yTickHideSpacer}
                interval={0}
              />
              <Tooltip
                {...rechartsTooltipShell}
                formatter={tooltipMetricFormatter}
                content={(props) => {
                  if (!props.active || !props.payload?.[0]) return null;
                  const row = props.payload[0].payload as ChartRow;
                  if (row.categorySpacer) return null;
                  return <DefaultTooltipContent {...props} formatter={tooltipMetricFormatter} />;
                }}
                labelFormatter={(_, i) => {
                  const r = sessionBarData[Number(i)];
                  if (!r || r.categorySpacer) return "";
                  return `${r.scenario} · ${r.api}`;
                }}
              />
              {avgTps !== undefined ? (
                <ReferenceLine
                  x={avgTps}
                  stroke="var(--chart-ref-line)"
                  strokeDasharray="3 3"
                  label={{ value: "avg TPS", fill: "var(--chart-tick)", fontSize: 9, position: "top" }}
                />
              ) : null}
              <Bar dataKey="tps" name="TPS (tok/s)" fill="var(--chart-tps)" radius={[0, 2, 2, 0]}>
                {sessionBarData.map((entry) => {
                  const fail = !entry.categorySpacer && entry.tps > 0 && entry.pass === false;
                  return (
                    <Cell
                      key={`tps-${entry.id}`}
                      fill={
                        entry.categorySpacer
                          ? "transparent"
                          : entry.tps > 0
                            ? barFill(entry.pass, "tps")
                            : "transparent"
                      }
                      fillOpacity={fail ? 0.55 : 1}
                      stroke={fail ? "var(--chart-fail)" : undefined}
                      strokeDasharray={fail ? "4 2" : undefined}
                      strokeWidth={fail ? 1.5 : 0}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <MetricChartLegend variant="session" />
        {onBarPayload ? (
          <p className="mt-1 text-center text-xs text-[var(--muted)]">막대를 클릭하면 해당 시나리오 상세를 엽니다.</p>
        ) : null}
      </div>
      <div className="min-h-72 min-w-0">
        {useSessionMultiRadar && pivotedSession.length >= MIN_RADAR_AXIS_COUNT ? (
          <RadarPanelsColumn
            axisCount={pivotedSession.length}
            compareSeries={sessionSeries}
            singleRows={null}
            pivoted={pivotedSession}
            mode="compare"
          />
        ) : radarAxisCount >= MIN_RADAR_AXIS_COUNT ? (
          <RadarPanelsColumn
            axisCount={radarAxisCount}
            compareSeries={[]}
            singleRows={chartRows}
            pivoted={[]}
            mode="single"
          />
        ) : useSessionMultiRadar ? (
          <p className="flex h-full min-h-64 items-center justify-center text-center text-sm text-[var(--muted)]">
            모델 간 레이더 비교는 시나리오가 3개 이상일 때 표시됩니다.
          </p>
        ) : (
          <p className="flex h-full min-h-64 items-center justify-center text-center text-sm text-[var(--muted)]">
            레이더 차트는 시나리오가 3개 이상일 때 표시됩니다.
          </p>
        )}
      </div>
    </div>
  );
}
