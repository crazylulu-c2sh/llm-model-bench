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
import { APPROX_TITLE, CAP_TITLE, GROUP_LABEL, METRIC_LABEL } from "../lib/score-bands";
import {
  buildScoreboardChartData,
  type ChartGroup,
  type ChartMetric,
  type ScoreboardChartDatum,
} from "../lib/scoreboard-chart";
import type { ScoreboardRow } from "../lib/scoreboard";

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

function truncId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 15)}…` : id;
}

/** 회전(-45°) X축 틱: 순위 번호 + 절단 모델명. 1위는 accent·굵게. (전체 id·caveat은 툴팁.) */
function ModelTick({
  x = 0,
  y = 0,
  payload,
  data,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
  data: ScoreboardChartDatum[];
}) {
  const id = String(payload?.value ?? "");
  const d = data.find((r) => r.model_id === id);
  const rank = d?.rank ?? 0;
  const isTop = rank === 1;
  const label = rank > 0 ? `${rank}. ${truncId(id)}` : truncId(id);
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        transform="rotate(-45)"
        x={0}
        y={0}
        dx={-4}
        dy={4}
        textAnchor="end"
        fontSize={10}
        fontWeight={isTop ? 600 : 400}
        fill={isTop ? "var(--accent)" : "var(--chart-tick)"}
      >
        {label}
      </text>
    </g>
  );
}

/** 막대 위 값 라벨: 반올림 점수(+caveat `*`). null은 `—`. 1위 accent·굵게. */
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
  const isTop = d.rank === 1;
  const caveat = (metric === "quality" && d.capped) || (metric === "speed" && d.approx);
  return (
    <text
      x={cx}
      y={cy}
      textAnchor="middle"
      fontSize={10}
      fontWeight={isTop ? 600 : 500}
      fill={isTop ? "var(--accent)" : "var(--foreground)"}
    >
      {Math.round(d.value ?? 0)}
      {caveat ? "*" : ""}
    </text>
  );
}

/** 커스텀 툴팁: 전체 model_id(+정체성 점) + 선택 그룹×지표 값 + caveat 문구. */
function ChartTooltip({
  active,
  payload,
  metric,
  group,
  colorByModel,
  multiModel,
}: {
  active?: boolean;
  payload?: Array<{ payload: ScoreboardChartDatum }>;
  metric: ChartMetric;
  group: ChartGroup;
  colorByModel: Map<string, string>;
  multiModel: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]!.payload;
  const val = d.isNull ? "—" : Math.round(d.value ?? 0);
  return (
    <div className="rounded border border-[var(--chart-tooltip-border)] bg-[var(--chart-tooltip-bg)] px-2.5 py-1.5 text-xs text-[var(--chart-tooltip-fg)] shadow">
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        {multiModel ? (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: colorByModel.get(d.model_id) }}
            aria-hidden
          />
        ) : null}
        <span className="font-mono">{d.model_id}</span>
      </div>
      <div className="font-mono">
        {GROUP_LABEL[group]} {METRIC_LABEL[metric]}: {val}
      </div>
      {metric === "quality" && d.capped ? (
        <div className="mt-1 text-[var(--chart-tooltip-label)]">* {CAP_TITLE}</div>
      ) : null}
      {metric === "speed" && d.approx ? (
        <div className="mt-1 text-[var(--chart-tooltip-label)]">* {APPROX_TITLE}</div>
      ) : null}
      {d.textOnly ? (
        <div className="mt-1 text-[var(--chart-tooltip-label)]">text-only — 총합이 텍스트 점수와 동일</div>
      ) : null}
    </div>
  );
}

const SLOT_PX = 54;

/**
 * 스코어보드 "랭킹 세로 막대 그래프". 이미 계산된 board를 받아 선택 (그룹×지표) 기준
 * best→worst 막대로 그린다(값 라벨·점수 밴드색·1위 강조·평균선). 표와 순서·색·caveat 일치.
 * 개별 막대는 focusable 아님 — 완전한 키보드/SR 접근은 표 뷰(뷰 토글)가 담당한다.
 */
export function ScoreboardChart({
  board,
  colorByModel,
  multiModel,
}: {
  board: ScoreboardRow[];
  colorByModel: Map<string, string>;
  multiModel: boolean;
}) {
  const [group, setGroup] = useState<ChartGroup>("total");
  const [metric, setMetric] = useState<ChartMetric>("quality");

  const { data, average, domainMax } = useMemo(
    () => buildScoreboardChartData(board, group, metric),
    [board, group, metric],
  );
  // recharts는 value:null 막대를 안 그리므로 plotValue(널→0)로 자리를 잡고, null 표기는 라벨(`—`)·색으로 구분.
  const rechartsData = useMemo(
    () => data.map((d) => ({ ...d, plotValue: d.isNull ? 0 : (d.value ?? 0) })),
    [data],
  );

  const anyCapped = metric === "quality" && data.some((d) => d.capped);
  const anyApprox = metric === "speed" && data.some((d) => d.approx);
  const anyTextOnly = data.some((d) => d.textOnly);
  const allNull = data.length === 0 || data.every((d) => d.isNull);
  const minWidth = Math.max(320, data.length * SLOT_PX);

  const summary = useMemo(() => {
    const scored = data.filter((d) => !d.isNull);
    const head = scored
      .slice(0, 3)
      .map((d) => `${d.rank}위 ${d.model_id} ${Math.round(d.value ?? 0)}`)
      .join(", ");
    const rest = scored.length > 3 ? ` 외 ${scored.length - 3}개` : "";
    const avg = average !== undefined ? `, 평균 ${Math.round(average)}` : "";
    return `${GROUP_LABEL[group]} ${METRIC_LABEL[metric]} 랭킹 — ${head}${rest}${avg}`;
  }, [data, average, group, metric]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel="지표"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "quality", label: METRIC_LABEL.quality },
            { value: "speed", label: METRIC_LABEL.speed },
          ]}
        />
        <Segmented
          ariaLabel="그룹"
          value={group}
          onChange={setGroup}
          options={[
            { value: "total", label: GROUP_LABEL.total },
            { value: "text", label: GROUP_LABEL.text },
            { value: "vision", label: GROUP_LABEL.vision },
          ]}
        />
      </div>

      {allNull ? (
        <p className="rounded border border-dashed border-[var(--border)] px-3 py-10 text-center text-xs text-[var(--muted)]">
          표시할 {GROUP_LABEL[group]} {METRIC_LABEL[metric]} 값이 없습니다. 다른 지표/그룹을 선택해 보세요.
        </p>
      ) : (
        <div className="overflow-x-auto" role="img" aria-label={summary}>
          <div style={{ minWidth }}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={rechartsData}
                margin={{ top: 24, right: 12, left: 0, bottom: 64 }}
                barCategoryGap="22%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="model_id"
                  type="category"
                  interval={0}
                  tickLine={false}
                  axisLine={{ stroke: "var(--chart-grid)" }}
                  tick={<ModelTick data={data} />}
                  height={64}
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
                      colorByModel={colorByModel}
                      multiModel={multiModel}
                    />
                  }
                />
                {average !== undefined && data.length >= 2 ? (
                  <ReferenceLine
                    y={average}
                    stroke="var(--chart-ref-line)"
                    strokeDasharray="4 4"
                    label={{
                      value: `평균 ${Math.round(average)}`,
                      fill: "var(--chart-tick)",
                      fontSize: 10,
                      position: "top",
                    }}
                  />
                ) : null}
                <Bar dataKey="plotValue" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {rechartsData.map((d) => (
                    <Cell
                      key={d.model_id}
                      fill={d.isNull ? "var(--border)" : d.color}
                      fillOpacity={d.isNull ? 0.35 : 1}
                      stroke={d.rank === 1 && !d.isNull ? "var(--accent)" : undefined}
                      strokeWidth={d.rank === 1 && !d.isNull ? 2 : 0}
                    />
                  ))}
                  <LabelList dataKey="plotValue" content={<ValueLabel data={data} metric={metric} />} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {anyCapped || anyApprox || anyTextOnly ? (
        <div className="mt-2 space-y-1 text-xs leading-relaxed text-[var(--muted)]">
          {anyCapped ? (
            <p>
              <code className="font-mono">*</code> (품질) {CAP_TITLE}.
            </p>
          ) : null}
          {anyApprox ? (
            <p>
              <code className="font-mono">*</code> (속도) {APPROX_TITLE}.
            </p>
          ) : null}
          {anyTextOnly ? (
            <p>
              <code className="font-mono">text-only</code> 비전 시나리오를 실행하지 않아 총합이 텍스트 점수로만 계산됐습니다.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
