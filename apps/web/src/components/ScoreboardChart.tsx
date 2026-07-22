import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ProviderKind, VendorKey } from "@llm-bench/shared";
import { cleanModelDisplayName, formatTps, inferModelVendor, parseModelQuant } from "@llm-bench/shared";
import {
  buildScoreboardChartData,
  reorderChartDataByVendor,
  type ChartGroup,
  type ChartMetric,
  type ScoreboardChartDatum,
} from "../lib/scoreboard-chart";
import type { ScoreboardRow } from "../lib/scoreboard";
import { BackendIcon, VENDOR_BRAND, VendorIcon, backendLabel, vendorGlyphSvg, vendorLabel } from "./VendorIcon";
import { useI18n, type Messages } from "../i18n";

/** 카드 내 세그먼트 토글(AppHeader 탭 시각 스타일 재사용). 뷰 토글에서도 import해 쓴다. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex flex-nowrap rounded-lg border-2 border-[var(--border)] bg-[var(--surface)] p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${ariaLabel} ${o.label}`}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-[var(--accent)] text-white shadow-sm"
                : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

type ColorMode = "score" | "vendor";
type OrderMode = "score" | "vendor";

/** 모델당 벤더·정제명·양자화(렌더마다 regex 방지). */
type ModelMeta = { vendor: VendorKey; display: string; quant: string | null };

/** 상위 3위 포디움 색(금/은/동) — index.css --podium-1/2/3 토큰(다크=기존값, 라이트=대비 심화). 그 외 null. */
const PODIUM_COLOR: Record<number, string> = { 1: "var(--podium-1)", 2: "var(--podium-2)", 3: "var(--podium-3)" };
function podiumColor(rank: number): string | null {
  return PODIUM_COLOR[rank] ?? null;
}

/** 벤더 색 막대 채움(currentColor 마크는 foreground로). */
function vendorBarFill(vendor: VendorKey): string {
  const c = VENDOR_BRAND[vendor].color;
  return c === "currentColor" ? "var(--foreground)" : c;
}

function truncName(s: string): string {
  // 네임스페이스 보존으로 이름이 길어져 한도를 상향(`LGAI-EXAONE/EXAONE-4.0-1.2B`≈27자까지 온전 노출).
  // 초과분은 말줄임 + 전체 id는 아래 <title> 툴팁으로 확인.
  return s.length > 28 ? `${s.slice(0, 27)}…` : s;
}

/**
 * 회전 X축 틱(레퍼런스 스타일): 막대 아래 미회전 벤더 로고 + 그 아래 45° 회전 정제명(순위 접두).
 * 1~3위는 포디움 색. 전체 id는 `<title>`.
 */
function ModelTick({
  x = 0,
  y = 0,
  payload,
  data,
  meta,
  msgs,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
  data: ScoreboardChartDatum[];
  meta: Map<string, ModelMeta>;
  msgs: Messages;
}) {
  const id = String(payload?.value ?? "");
  const d = data.find((r) => r.model_id === id);
  const m = meta.get(id);
  const rank = d?.rank ?? 0;
  const nameColor = podiumColor(rank) ?? (rank === 1 ? "var(--accent)" : "var(--chart-tick)");
  const display = m ? m.display : id;
  const label = rank > 0 ? `${rank}. ${truncName(display)}` : truncName(display);
  return (
    <g transform={`translate(${x},${y})`}>
      {m ? vendorGlyphSvg(m.vendor, 0, 2, 18, vendorLabel(m.vendor, msgs)) : null}
      <text
        transform="translate(0,26) rotate(-45)"
        textAnchor="end"
        fontSize={10}
        fontWeight={rank >= 1 && rank <= 3 ? 600 : 400}
        fill={nameColor}
      >
        {label}
        <title>{id}</title>
      </text>
    </g>
  );
}

/** 막대 위 값 라벨: 반올림 점수(+caveat `*`). null은 `—`. 1~3위 포디움 색·굵게. */
function ValueLabel({
  x = 0,
  y = 0,
  width = 0,
  index = 0,
  data,
  metric,
}: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  index?: number;
  data: ScoreboardChartDatum[];
  metric: ChartMetric;
}) {
  const d = data[index];
  if (!d) return null;
  const cx = Number(x) + Number(width) / 2;
  const cy = Number(y) - 5;
  if (d.isNull) {
    return (
      <text x={cx} y={cy} textAnchor="middle" fontSize={10} fill="var(--muted)">
        —
      </text>
    );
  }
  const podium = d.rank >= 1 && d.rank <= 3;
  const caveat = (metric === "quality" && d.capped) || (metric === "speed" && d.approx);
  return (
    <text
      x={cx}
      y={cy}
      textAnchor="middle"
      fontSize={10}
      fontWeight={podium ? 700 : 500}
      fill={podiumColor(d.rank) ?? "var(--foreground)"}
    >
      {Math.round(d.value ?? 0)}
      {caveat ? "*" : ""}
    </text>
  );
}

/** 커스텀 툴팁: 벤더 아이콘·라벨 + (백엔드) + 전체 model_id + 양자화 + 값 + caveat. */
function ChartTooltip({
  active,
  payload,
  metric,
  group,
  meta,
  providerByModel,
  msgs,
}: {
  active?: boolean;
  payload?: Array<{ payload: ScoreboardChartDatum }>;
  metric: ChartMetric;
  group: ChartGroup;
  meta: Map<string, ModelMeta>;
  providerByModel?: Map<string, ProviderKind>;
  msgs: Messages;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]!.payload;
  const m = meta.get(d.model_id);
  const provider = providerByModel?.get(d.model_id);
  const val = d.isNull
    ? "—"
    : metric === "speed"
      ? `${formatTps(d.value)} tok/s`
      : Math.round(d.value ?? 0);
  return (
    <div className="rounded border border-[var(--chart-tooltip-border)] bg-[var(--chart-tooltip-bg)] px-2.5 py-1.5 text-xs text-[var(--chart-tooltip-fg)] shadow">
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        {m ? <VendorIcon vendor={m.vendor} size={14} className="shrink-0" /> : null}
        <span>{m ? vendorLabel(m.vendor, msgs) : msgs.scoreboard.modelFallback}</span>
        {provider ? (
          <>
            <span className="text-[var(--chart-tooltip-label)]">·</span>
            <BackendIcon provider={provider} size={12} className="shrink-0" />
            <span className="text-[var(--chart-tooltip-label)]">{backendLabel(provider, msgs)}</span>
          </>
        ) : null}
        {m?.quant ? (
          <span className="rounded border border-[var(--chart-tooltip-border)] px-1 font-mono text-[10px]">
            {m.quant}
          </span>
        ) : null}
      </div>
      <div className="font-mono text-[11px] text-[var(--chart-tooltip-label)]">{d.model_id}</div>
      <div className="mt-0.5 font-mono">
        {msgs.scoreboard.groupLabel[group]} {msgs.scoreboard.metricLabel[metric]}: {val}
      </div>
      {metric === "quality" && d.capped ? (
        <div className="mt-1 text-[var(--chart-tooltip-label)]">* {msgs.scoreboard.capTitle}</div>
      ) : null}
      {metric === "speed" && d.approx ? (
        <div className="mt-1 text-[var(--chart-tooltip-label)]">* {msgs.scoreboard.approxTitle}</div>
      ) : null}
      {d.textOnly ? (
        <div className="mt-1 text-[var(--chart-tooltip-label)]">{msgs.scoreboard.chartTextOnlyNote}</div>
      ) : null}
    </div>
  );
}

const SLOT_PX = 60;

/**
 * 스코어보드 "랭킹 세로 막대 그래프". 이미 계산된 board를 받아 선택 (그룹×지표) 기준
 * best→worst 막대로 그린다. 막대 아래 벤더 로고 + 정제명, 값 라벨, 점수/벤더 색, 포디움, 평균선.
 * 개별 막대는 focusable 아님 — 완전한 키보드/SR 접근은 표 뷰(뷰 토글)가 담당한다.
 */
export function ScoreboardChart({
  board,
  providerByModel,
}: {
  board: ScoreboardRow[];
  providerByModel?: Map<string, ProviderKind>;
}) {
  const { m } = useI18n();
  const [group, setGroup] = useState<ChartGroup>("total");
  const [metric, setMetric] = useState<ChartMetric>("quality");
  const [colorMode, setColorMode] = useState<ColorMode>("score");
  const [orderMode, setOrderMode] = useState<OrderMode>("score");

  const meta = useMemo(
    () =>
      new Map<string, ModelMeta>(
        board.map((b) => [
          b.model_id,
          {
            vendor: inferModelVendor(b.model_id),
            display: cleanModelDisplayName(b.model_id),
            quant: parseModelQuant(b.model_id),
          },
        ]),
      ),
    [board],
  );

  const { data, average, domainMax } = useMemo(
    () => buildScoreboardChartData(board, group, metric),
    [board, group, metric],
  );
  // 정렬 모드: 벤더별이면 벤더 그룹으로 재배열(rank는 metric 랭킹 그대로 유지).
  const displayData = useMemo(
    () =>
      orderMode === "vendor"
        ? reorderChartDataByVendor(data, (id) => meta.get(id)?.vendor ?? "unknown")
        : data,
    [data, orderMode, meta],
  );
  // recharts는 value:null 막대를 안 그리므로 plotValue(널→0)로 자리를 잡고, null 표기는 라벨(`—`)·색으로 구분.
  const rechartsData = useMemo(
    () => displayData.map((d) => ({ ...d, plotValue: d.isNull ? 0 : (d.value ?? 0) })),
    [displayData],
  );

  const anyCapped = metric === "quality" && data.some((d) => d.capped);
  const anyApprox = metric === "speed" && data.some((d) => d.approx);
  const anyTextOnly = data.some((d) => d.textOnly);
  const allNull = data.length === 0 || data.every((d) => d.isNull);
  const minWidth = Math.max(320, data.length * SLOT_PX);

  // 벤더 색 모드 범례: 실제 등장한 벤더만(등장 순서).
  const legendVendors = useMemo(() => {
    const seen = new Set<VendorKey>();
    const out: VendorKey[] = [];
    for (const d of data) {
      const v = meta.get(d.model_id)?.vendor ?? "unknown";
      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
    return out;
  }, [data, meta]);

  const summary = useMemo(() => {
    const scored = data.filter((d) => !d.isNull);
    const head = scored
      .slice(0, 3)
      .map((d) => m.scoreboard.summaryRankItem(d.rank, d.model_id, Math.round(d.value ?? 0)))
      .join(", ");
    const rest = scored.length > 3 ? m.scoreboard.summaryRest(scored.length - 3) : "";
    const avg = average !== undefined ? m.scoreboard.summaryAvg(Math.round(average)) : "";
    return m.scoreboard.summary(
      m.scoreboard.groupLabel[group],
      m.scoreboard.metricLabel[metric],
      `${head}${rest}${avg}`,
    );
  }, [data, average, group, metric, m]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel={m.scoreboard.metricAria}
          value={metric}
          onChange={setMetric}
          options={[
            { value: "quality", label: m.scoreboard.metricLabel.quality },
            { value: "speed", label: m.scoreboard.metricLabel.speed },
          ]}
        />
        <Segmented
          ariaLabel={m.scoreboard.groupAria}
          value={group}
          onChange={setGroup}
          options={[
            { value: "total", label: m.scoreboard.groupLabel.total },
            { value: "text", label: m.scoreboard.groupLabel.text },
            { value: "vision", label: m.scoreboard.groupLabel.vision },
            { value: "agent", label: m.scoreboard.groupLabel.agent },
          ]}
        />
        <Segmented
          ariaLabel={m.scoreboard.colorAria}
          value={colorMode}
          onChange={setColorMode}
          options={[
            { value: "score", label: m.scoreboard.colorScore },
            { value: "vendor", label: m.scoreboard.colorVendor },
          ]}
        />
        <Segmented
          ariaLabel={m.scoreboard.orderAria}
          value={orderMode}
          onChange={setOrderMode}
          options={[
            { value: "score", label: m.scoreboard.orderScore },
            { value: "vendor", label: m.scoreboard.orderVendor },
          ]}
        />
        {average !== undefined ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-[var(--muted)]">
            <span
              className="inline-block h-0 w-4 border-t border-dashed border-[var(--chart-ref-line)]"
              aria-hidden
            />
            {m.scoreboard.averageLabel} {Math.round(average)}
          </span>
        ) : null}
      </div>

      {allNull ? (
        <p className="rounded border border-dashed border-[var(--border)] px-3 py-10 text-center text-xs text-[var(--muted)]">
          {m.scoreboard.emptyValues(m.scoreboard.groupLabel[group], m.scoreboard.metricLabel[metric])}
        </p>
      ) : (
        <div className="overflow-x-auto" role="img" aria-label={summary}>
          <div style={{ minWidth }}>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart
                data={rechartsData}
                margin={{ top: 24, right: 16, left: 0, bottom: 120 }}
                barCategoryGap="22%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="model_id"
                  type="category"
                  interval={0}
                  tickLine={false}
                  axisLine={{ stroke: "var(--chart-grid)" }}
                  tick={<ModelTick data={displayData} meta={meta} msgs={m} />}
                  height={128}
                />
                <YAxis
                  type="number"
                  domain={[0, domainMax]}
                  width={34}
                  tick={{ fill: "var(--chart-tick)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--chart-cursor)" }}
                  content={
                    <ChartTooltip
                      metric={metric}
                      group={group}
                      meta={meta}
                      providerByModel={providerByModel}
                      msgs={m}
                    />
                  }
                />
                {average !== undefined && data.length >= 2 ? (
                  <ReferenceLine y={average} stroke="var(--chart-ref-line)" strokeDasharray="4 4" />
                ) : null}
                <Bar dataKey="plotValue" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {rechartsData.map((d) => {
                    const fill = d.isNull
                      ? "var(--border)"
                      : colorMode === "vendor"
                        ? vendorBarFill(meta.get(d.model_id)?.vendor ?? "unknown")
                        : d.color;
                    return (
                      <Cell
                        key={d.model_id}
                        fill={fill}
                        fillOpacity={d.isNull ? 0.35 : 1}
                        stroke={d.rank === 1 && !d.isNull ? "var(--accent)" : undefined}
                        strokeWidth={d.rank === 1 && !d.isNull ? 2 : 0}
                      />
                    );
                  })}
                  <LabelList dataKey="plotValue" content={<ValueLabel data={displayData} metric={metric} />} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {colorMode === "vendor" && !allNull ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
          {legendVendors.map((v) => (
            <span key={v} className="inline-flex items-center gap-1">
              <VendorIcon vendor={v} size={12} />
              {vendorLabel(v, m)}
            </span>
          ))}
        </div>
      ) : null}

      {anyCapped || anyApprox || anyTextOnly ? (
        <div className="mt-2 space-y-1 text-xs leading-relaxed text-[var(--muted)]">
          {anyCapped ? (
            <p>
              <code className="font-mono">*</code> {m.scoreboard.qualityTag} {m.scoreboard.capTitle}.
            </p>
          ) : null}
          {anyApprox ? (
            <p>
              <code className="font-mono">*</code> {m.scoreboard.speedTag} {m.scoreboard.approxTitle}.
            </p>
          ) : null}
          {anyTextOnly ? (
            <p>
              <code className="font-mono">text-only</code> {m.scoreboard.textOnlyFootnote}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
