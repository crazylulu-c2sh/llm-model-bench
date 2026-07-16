import { useMemo, useState } from "react";
import { ArrowDown, ArrowDownUp, ArrowUp } from "lucide-react";
import {
  agentMetricsFromRows,
  formatTps,
  formatTtftMs,
  inferModelVendor,
  leakMetricsFromRows,
  type ProviderKind,
  type VendorKey,
} from "@llm-bench/shared";
import type { ResultRow } from "./ResultsTable";
import { LeakTable } from "./LeakTable";
import { AgentMetricsTable } from "./AgentMetricsTable";
import { buildModelColorMap } from "../lib/model-color";
import {
  DEFAULT_SCOREBOARD_SORT,
  naturalDir,
  sameSortKey,
  scoreboardFromRows,
  sortEquals,
  sortScoreboard,
  type ScoreboardSort,
  type ScoreboardSortKey,
  type ScoreGroup,
  type ScoreMetric,
  type ScoreboardRow,
  type ScoringAggregate,
  type SortDir,
} from "../lib/scoreboard";
import type { QualityGroupScore } from "../lib/quality-score";
import type { SpeedGroup } from "../lib/speed-score";
import {
  APPROX_TITLE,
  BAND_COLOR,
  CAP_TITLE,
  GROUP_LABEL,
  METRIC_LABEL,
  qualityBand,
} from "../lib/score-bands";
import { getTpsTier, tpsTierColor } from "../lib/tps-tier";
import { ScoreboardChart, Segmented } from "./ScoreboardChart";
import { ModelLabel } from "./ModelLabel";
import { VENDOR_BRAND, VendorIcon } from "./VendorIcon";

/** max 기준 상대 길이 채움 막대(기본 max=100=절대). */
function ScoreBar({ value, color, max = 100 }: { value: number; color: string; max?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className="mx-auto mt-1 block h-1 w-full max-w-[3.25rem] overflow-hidden rounded-full bg-[var(--border)]">
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} aria-hidden />
    </span>
  );
}

function Caveat({ title }: { title: string }) {
  return (
    <span className="text-[var(--muted)]" title={title}>
      *
    </span>
  );
}

/** 품질 셀: 밴드색 숫자 + 막대 + (커버리지) + judge-cap `*`. */
function QualityCell({ g, capped }: { g: QualityGroupScore; capped: boolean }) {
  const coverage = g.expected > 0 ? `${g.covered}/${g.expected}` : null;
  if (g.value == null) {
    return (
      <span className="inline-flex flex-col items-center leading-tight">
        <span className="font-mono text-xs text-[var(--muted)]">
          —{capped ? <Caveat title={CAP_TITLE} /> : null}
        </span>
        {coverage ? <span className="text-[10px] text-[var(--muted)]">({coverage})</span> : null}
      </span>
    );
  }
  const color = BAND_COLOR[qualityBand(g.value)];
  return (
    <span className="inline-flex w-full flex-col items-center leading-tight">
      <span className="font-mono text-xs font-semibold" style={{ color }}>
        {Math.round(g.value)}
        {capped ? <Caveat title={CAP_TITLE} /> : null}
      </span>
      <ScoreBar value={g.value} color={color} />
      {coverage ? <span className="mt-0.5 text-[10px] text-[var(--muted)]">({coverage})</span> : null}
    </span>
  );
}

/** 속도 셀: 디코드 tok/s 중앙값(주값·절대 tier 색) + 열 최고 대비 상대 막대 + 점수 보조 + approx `*`. */
function SpeedCell({ g, max }: { g: SpeedGroup; max: number }) {
  if (g.tpsMedian == null) return <span className="font-mono text-xs text-[var(--muted)]">—</span>;
  const color = tpsTierColor(getTpsTier(g.tpsMedian, false));
  const range =
    g.tpsMin != null && g.tpsMax != null
      ? ` · 범위 ${formatTps(g.tpsMin)}~${formatTps(g.tpsMax)} tok/s`
      : "";
  return (
    <span
      className="inline-flex w-full flex-col items-center leading-tight"
      title={`중앙값 ${formatTps(g.tpsMedian)} tok/s${range} · 점수 ${g.score}`}
    >
      <span className="font-mono text-xs font-semibold" style={{ color }}>
        {formatTps(g.tpsMedian)}
        <span className="text-[10px] font-normal text-[var(--muted)]"> tok/s</span>
        {g.approxRows > 0 ? <Caveat title={APPROX_TITLE} /> : null}
      </span>
      <ScoreBar value={g.tpsMedian} color={color} max={max} />
      {g.score != null ? (
        <span className="mt-0.5 text-[10px] text-[var(--muted)]">{g.score}점</span>
      ) : null}
    </span>
  );
}

/** 지연 셀: raw TTFT 평균(ms, 낮을수록 좋음). 점수·막대·밴드 없음. */
function TtftCell({ g }: { g: SpeedGroup }) {
  return g.ttftMs == null ? (
    <span className="font-mono text-xs text-[var(--muted)]">—</span>
  ) : (
    <span className="font-mono text-xs text-[var(--muted)]">{formatTtftMs(g.ttftMs)}ms</span>
  );
}

const GROUP_BORDER = "border-l border-[var(--border)]";

const METRIC_TITLE: Record<ScoreMetric, string> = {
  quality: "정답률·루브릭(0~100)",
  speed: "디코드 TPS 중앙값(실제 tok/s). 정렬·색 기준. 아래 작은 숫자는 기준 30 tok/s=1000 점수",
  latency: "Time-To-First-Token, 첫 토큰까지 ms(낮을수록 좋음, 점수 비포함)",
};

/** 정렬 방향 아이콘(StatsModelTable 패턴): 활성 asc/desc + 비활성 흐림. */
function sortDirIcon(active: boolean, dir: SortDir) {
  if (!active) return <ArrowDownUp className="size-3.5 shrink-0 opacity-45" aria-hidden />;
  return dir === "asc" ? (
    <ArrowUp className="size-3.5 shrink-0 opacity-90" aria-hidden />
  ) : (
    <ArrowDown className="size-3.5 shrink-0 opacity-90" aria-hidden />
  );
}

/** 현재 정렬 상태 한 줄 요약(표 하단 표시). */
function scoreboardSortLine(sort: ScoreboardSort): string {
  const name =
    sort.key.kind === "model"
      ? "모델"
      : `${GROUP_LABEL[sort.key.group]} ${METRIC_LABEL[sort.key.metric]}`;
  return `정렬: ${name} · ${sort.dir === "asc" ? "오름차순" : "내림차순"}`;
}

/** 클릭 정렬 가능한 헤더 셀 — 기존 <th>(className·title) 보존 + 내부 버튼·아이콘·aria. */
function SortHeader({
  label,
  title,
  thClassName,
  buttonClassName = "mx-auto text-[11px] font-normal",
  sortKey,
  sort,
  onSort,
  rowSpan,
}: {
  label: string;
  title?: string;
  thClassName: string;
  buttonClassName?: string;
  sortKey: ScoreboardSortKey;
  sort: ScoreboardSort;
  onSort: (key: ScoreboardSortKey) => void;
  rowSpan?: number;
}) {
  const active = sameSortKey(sort.key, sortKey);
  const ariaSort: "ascending" | "descending" | "none" = active
    ? sort.dir === "asc"
      ? "ascending"
      : "descending"
    : "none";
  const dirText = active ? (sort.dir === "asc" ? " (오름차순)" : " (내림차순)") : "";
  return (
    <th className={thClassName} title={title} aria-sort={ariaSort} rowSpan={rowSpan}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`${label} 기준 정렬${dirText}`}
        className={`inline-flex items-center gap-1 text-[var(--muted)] hover:text-[var(--foreground)] ${buttonClassName}`}
      >
        {label}
        {sortDirIcon(active, sort.dir)}
      </button>
    </th>
  );
}

/** 한 그룹(text|vision|total)의 품질/속도/지연 정렬 헤더 3셀. */
function GroupSortHeaders({
  group,
  sort,
  onSort,
}: {
  group: ScoreGroup;
  sort: ScoreboardSort;
  onSort: (key: ScoreboardSortKey) => void;
}) {
  const base = "px-2 pb-2 text-center text-[11px] font-normal";
  return (
    <>
      <SortHeader
        label={METRIC_LABEL.quality}
        title={METRIC_TITLE.quality}
        thClassName={`${base} ${GROUP_BORDER}`}
        sortKey={{ kind: "metric", group, metric: "quality" }}
        sort={sort}
        onSort={onSort}
      />
      <SortHeader
        label={METRIC_LABEL.speed}
        title={METRIC_TITLE.speed}
        thClassName={base}
        sortKey={{ kind: "metric", group, metric: "speed" }}
        sort={sort}
        onSort={onSort}
      />
      <SortHeader
        label={METRIC_LABEL.latency}
        title={METRIC_TITLE.latency}
        thClassName={base}
        sortKey={{ kind: "metric", group, metric: "latency" }}
        sort={sort}
        onSort={onSort}
      />
    </>
  );
}

/** 벤치 큐에 있으나 아직 집계되지 않은 모델 행 — 결과 테이블 pendingRows 패턴. */
function ScoreboardSkeletonRow({
  modelId,
  rank,
  barColor,
  multiModel,
}: {
  modelId: string;
  rank: number;
  barColor?: string;
  multiModel: boolean;
}) {
  const pulse = "mx-auto h-3 w-10 animate-pulse rounded bg-[var(--border)]";
  return (
    <tr className="border-t border-[var(--border)] opacity-40" aria-hidden="true">
      <td className="relative p-2">
        {barColor ? (
          <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: barColor }} aria-hidden />
        ) : null}
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-[var(--muted)]">
          <span className="font-mono">{rank}.</span>
          {multiModel && barColor ? (
            <span className="size-2 shrink-0 rounded-full" style={{ background: barColor }} aria-hidden />
          ) : null}
          <ModelLabel modelId={modelId} size={14} />
        </span>
      </td>
      {Array.from({ length: 12 }, (_, ci) => (
        <td key={ci} className={`p-2 text-center${ci % 3 === 0 ? ` ${GROUP_BORDER}` : ""}`}>
          <div className={pulse} />
        </td>
      ))}
    </tr>
  );
}

function ScoreboardDataRow({
  b,
  rank,
  barColor,
  multiModel,
  maxSpeed,
  provider,
}: {
  b: ScoreboardRow;
  rank: number;
  barColor?: string;
  multiModel: boolean;
  maxSpeed: { text: number; vision: number; agent: number; total: number };
  provider?: ProviderKind;
}) {
  const cap = b.quality.caveats.includes("judge_capped");
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="relative p-2">
        {barColor ? (
          <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: barColor }} aria-hidden />
        ) : null}
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-[var(--foreground)]">
          <span className="font-mono text-[var(--muted)]">{rank}.</span>
          {multiModel && barColor ? (
            <span className="size-2 shrink-0 rounded-full" style={{ background: barColor }} aria-hidden />
          ) : null}
          <ModelLabel modelId={b.model_id} provider={provider} showBackend showQuant size={14} />
          {b.textOnly ? (
            <span
              className="rounded border border-[var(--border)] px-1 py-px text-[10px] text-[var(--muted)]"
              title="비전·에이전트 시나리오 미실행 — 총합은 텍스트 점수와 동일"
            >
              text-only
            </span>
          ) : null}
        </span>
      </td>
      <td className={`p-2 text-center ${GROUP_BORDER}`}>
        <QualityCell g={b.quality.text} capped={false} />
      </td>
      <td className="p-2 text-center">
        <SpeedCell g={b.speed.text} max={maxSpeed.text} />
      </td>
      <td className="p-2 text-center">
        <TtftCell g={b.speed.text} />
      </td>
      <td className={`p-2 text-center ${GROUP_BORDER}`}>
        <QualityCell g={b.quality.vision} capped={cap} />
      </td>
      <td className="p-2 text-center">
        <SpeedCell g={b.speed.vision} max={maxSpeed.vision} />
      </td>
      <td className="p-2 text-center">
        <TtftCell g={b.speed.vision} />
      </td>
      <td className={`p-2 text-center ${GROUP_BORDER}`}>
        <QualityCell g={b.quality.agent} capped={cap} />
      </td>
      <td className="p-2 text-center">
        <SpeedCell g={b.speed.agent} max={maxSpeed.agent} />
      </td>
      <td className="p-2 text-center">
        <TtftCell g={b.speed.agent} />
      </td>
      <td className={`p-2 text-center ${GROUP_BORDER}`}>
        <QualityCell g={b.quality.total} capped={cap} />
      </td>
      <td className="p-2 text-center">
        <SpeedCell g={b.speed.total} max={maxSpeed.total} />
      </td>
      <td className="p-2 text-center">
        <TtftCell g={b.speed.total} />
      </td>
    </tr>
  );
}

export function Scoreboard({
  rows,
  detailAggregate,
  loading = false,
  benchModelOrder = [],
  title = "스코어보드",
  providerByModel,
}: {
  rows: ResultRow[];
  detailAggregate: ScoringAggregate;
  loading?: boolean;
  /** 벤치 실행 중 큐 순서 — 스켈레톤이 모든 모델 행 공간을 미리 확보 */
  benchModelOrder?: string[];
  title?: string;
  /** model_id → 백엔드(옵션). 벤더 아이콘 옆 백엔드 배지·툴팁용. 없어도 안 깨짐. */
  providerByModel?: Map<string, ProviderKind>;
}) {
  const board = useMemo(() => scoreboardFromRows(rows, detailAggregate), [rows, detailAggregate]);
  // #80: 모델 × 라우트 누수/정체 지표(스코어보드와 동일 rows+aggregate에서 클라이언트 계산 — 서버와 동일 산식).
  const leaks = useMemo(() => leakMetricsFromRows(rows, detailAggregate), [rows, detailAggregate]);
  // #105: 모델 × 라우트 에이전트 능력 지표(agent_* 완료 런).
  const agentMetrics = useMemo(() => agentMetricsFromRows(rows, detailAggregate), [rows, detailAggregate]);
  const [sort, setSort] = useState<ScoreboardSort>(DEFAULT_SCOREBOARD_SORT);
  const [view, setView] = useState<"chart" | "table" | "leaks" | "agent">("chart");
  const [hiddenVendors, setHiddenVendors] = useState<Set<VendorKey>>(() => new Set());
  function onSortClick(key: ScoreboardSortKey) {
    setSort((prev) =>
      sameSortKey(prev.key, key)
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } // 같은 컬럼 → 방향 토글
        : { key, dir: naturalDir(key) }, // 새 컬럼 → 자연 기본 방향
    );
  }
  // 벤더 필터: board에서 등장 벤더 집계 → 숨김 토글이 차트·표·누수 뷰 모두에 반영된다.
  const vendorCounts = useMemo(() => {
    const m = new Map<VendorKey, number>();
    for (const b of board) m.set(inferModelVendor(b.model_id), (m.get(inferModelVendor(b.model_id)) ?? 0) + 1);
    return m;
  }, [board]);
  const filteredBoard = useMemo(
    () =>
      hiddenVendors.size === 0
        ? board
        : board.filter((b) => !hiddenVendors.has(inferModelVendor(b.model_id))),
    [board, hiddenVendors],
  );
  const filteredLeaks = useMemo(
    () =>
      hiddenVendors.size === 0
        ? leaks
        : leaks.filter((l) => !hiddenVendors.has(inferModelVendor(l.model_id))),
    [leaks, hiddenVendors],
  );
  const filteredAgentMetrics = useMemo(
    () =>
      hiddenVendors.size === 0
        ? agentMetrics
        : agentMetrics.filter((a) => !hiddenVendors.has(inferModelVendor(a.model_id))),
    [agentMetrics, hiddenVendors],
  );
  function toggleVendor(v: VendorKey) {
    setHiddenVendors((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }
  // 기본 정렬이면 재정렬 생략 → computeScoreboard의 3단계 순서(총합 속도 tie-break 포함) 그대로 유지.
  const sortedBoard = useMemo(
    () => (sortEquals(sort, DEFAULT_SCOREBOARD_SORT) ? filteredBoard : sortScoreboard(filteredBoard, sort)),
    [filteredBoard, sort],
  );
  const colorByModel = useMemo(() => buildModelColorMap(rows.map((r) => r.model_id)), [rows]);
  // 속도 막대는 각 열(텍스트/비전/총합) 최고 tok/s(중앙값) 대비 상대 길이 — 열별 max를 미리 구한다(필터 반영).
  const maxSpeed = useMemo(() => {
    const m = { text: 0, vision: 0, agent: 0, total: 0 };
    for (const b of filteredBoard) {
      if (b.speed.text.tpsMedian != null) m.text = Math.max(m.text, b.speed.text.tpsMedian);
      if (b.speed.vision.tpsMedian != null) m.vision = Math.max(m.vision, b.speed.vision.tpsMedian);
      if (b.speed.agent.tpsMedian != null) m.agent = Math.max(m.agent, b.speed.agent.tpsMedian);
      if (b.speed.total.tpsMedian != null) m.total = Math.max(m.total, b.speed.total.tpsMedian);
    }
    return m;
  }, [filteredBoard]);

  const loadingLayout = loading && benchModelOrder.length > 0;
  const boardByModelId = useMemo(() => new Map(board.map((b) => [b.model_id, b])), [board]);
  const queueColorByModel = useMemo(
    () => (loadingLayout ? buildModelColorMap(benchModelOrder) : colorByModel),
    [loadingLayout, benchModelOrder, colorByModel],
  );

  if (!loading && board.length === 0) return null;
  if (loading && benchModelOrder.length === 0 && board.length === 0) return null;

  const multiModel = loadingLayout ? benchModelOrder.length >= 2 : colorByModel.size >= 2;
  const anyJudgeCap = filteredBoard.some((b) => b.quality.caveats.includes("judge_capped"));
  const anyApprox = filteredBoard.some((b) => b.speed.approxCaveat);
  const anyTextOnly = filteredBoard.some((b) => b.textOnly);
  // 기본=차트지만 라이브 벤치 로딩 중엔 큐-순서 표 스켈레톤을 강제(차트 스켈레톤은 후속). 데이터 도착 후 토글대로.
  const showChart = view === "chart" && !loadingLayout;
  // 벤더 필터는 벤치 로딩 중이 아니고 벤더가 2종 이상일 때만 노출.
  const showVendorFilter = !loadingLayout && vendorCounts.size >= 2;
  const allVendorsHidden = !loadingLayout && filteredBoard.length === 0;

  return (
    <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
      <div className="mb-1 flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">{title}</h2>
        {!loadingLayout ? (
          <Segmented
            ariaLabel="보기"
            value={view}
            onChange={setView}
            options={[
              { value: "chart", label: "차트" },
              { value: "table", label: "표" },
              { value: "leaks", label: "누수" },
              { value: "agent", label: "에이전트" },
            ]}
          />
        ) : null}
      </div>
      <p className="mb-2 text-xs text-[var(--muted)]">
        품질은 절대 점수(0~100), 속도는 디코드 TPS 중앙값(실제 tok/s)이고 색은 절대 tier(쾌적≥30·쓸만≥15·채택가능≥5),
        작은 숫자는 기준 30 tok/s=1000 점수. 지연(TTFT)은 첫 토큰까지 ms로 낮을수록 좋음(점수 미포함). 측정 런 평균 ·
        텍스트/비전은 시나리오 동일 가중, 총합은 전체 풀링.{showChart ? " 막대에 커서를 올리면 상세." : " 헤더를 눌러 정렬."}
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
        <span>품질 색상 = 절대 점수 밴드:</span>
        {(
          [
            ["var(--tier-fast)", "우수"],
            ["var(--tier-good)", "양호"],
            ["var(--tier-okay)", "보통"],
            ["var(--tier-slow)", "낮음"],
          ] as const
        ).map(([c, label]) => (
          <span key={label} className="inline-flex items-center gap-1">
            <span className="size-2 shrink-0 rounded-full" style={{ background: c }} aria-hidden />
            {label}
          </span>
        ))}
        <span className="w-full text-[var(--muted)]">
          속도 = 디코드 TPS 중앙값(tok/s) · 색=절대 tier·막대=열 최고 대비 상대 · 지연 = TTFT ms(낮을수록 좋음)
        </span>
      </div>
      {showVendorFilter ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-[var(--muted)]">벤더:</span>
          {[...vendorCounts.entries()]
            .sort((a, b) => b[1] - a[1] || (VENDOR_BRAND[a[0]].label < VENDOR_BRAND[b[0]].label ? -1 : 1))
            .map(([v, count]) => {
              const hidden = hiddenVendors.has(v);
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => toggleVendor(v)}
                  aria-pressed={!hidden}
                  title={`${VENDOR_BRAND[v].label} ${hidden ? "보이기" : "숨기기"}`}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors ${
                    hidden
                      ? "border border-dashed border-[var(--border)] text-[var(--muted)] opacity-60"
                      : "border border-[var(--accent)] text-[var(--foreground)]"
                  }`}
                >
                  <VendorIcon vendor={v} size={12} />
                  {VENDOR_BRAND[v].label}
                  <span className="text-[var(--muted)]">{count}</span>
                </button>
              );
            })}
          {hiddenVendors.size > 0 ? (
            <button
              type="button"
              onClick={() => setHiddenVendors(new Set())}
              className="ml-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              전체
            </button>
          ) : null}
        </div>
      ) : null}
      {allVendorsHidden ? (
        <p className="rounded border border-dashed border-[var(--border)] px-3 py-10 text-center text-xs text-[var(--muted)]">
          모든 벤더가 숨겨졌습니다. 위 필터에서 벤더를 선택해 다시 표시하세요.
        </p>
      ) : showChart ? (
        <ScoreboardChart board={filteredBoard} providerByModel={providerByModel} />
      ) : view === "leaks" && !loadingLayout ? (
        <LeakTable leaks={filteredLeaks} />
      ) : view === "agent" && !loadingLayout ? (
        <AgentMetricsTable metrics={filteredAgentMetrics} />
      ) : (
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full min-w-[58rem] text-left text-sm">
          <thead className="bg-[var(--surface)] text-[var(--muted)]">
            <tr>
              <SortHeader
                label="모델"
                thClassName="p-2 align-bottom font-medium"
                buttonClassName="font-medium"
                sortKey={{ kind: "model" }}
                sort={sort}
                onSort={onSortClick}
                rowSpan={2}
              />
              <th colSpan={3} className={`p-2 text-center font-medium ${GROUP_BORDER}`}>
                텍스트
              </th>
              <th colSpan={3} className={`p-2 text-center font-medium ${GROUP_BORDER}`}>
                비전
              </th>
              <th colSpan={3} className={`p-2 text-center font-medium ${GROUP_BORDER}`}>
                에이전트
              </th>
              <th colSpan={3} className={`p-2 text-center font-medium ${GROUP_BORDER}`}>
                총합
              </th>
            </tr>
            <tr>
              <GroupSortHeaders group="text" sort={sort} onSort={onSortClick} />
              <GroupSortHeaders group="vision" sort={sort} onSort={onSortClick} />
              <GroupSortHeaders group="agent" sort={sort} onSort={onSortClick} />
              <GroupSortHeaders group="total" sort={sort} onSort={onSortClick} />
            </tr>
          </thead>
          <tbody>
            {loadingLayout
              ? benchModelOrder.map((modelId, i) => {
                  const b = boardByModelId.get(modelId);
                  const barColor = multiModel ? queueColorByModel.get(modelId) : undefined;
                  if (b) {
                    return (
                      <ScoreboardDataRow
                        key={modelId}
                        b={b}
                        rank={i + 1}
                        barColor={barColor}
                        multiModel={multiModel}
                        maxSpeed={maxSpeed}
                        provider={providerByModel?.get(modelId)}
                      />
                    );
                  }
                  return (
                    <ScoreboardSkeletonRow
                      key={modelId}
                      modelId={modelId}
                      rank={i + 1}
                      barColor={barColor}
                      multiModel={multiModel}
                    />
                  );
                })
              : sortedBoard.map((b, i) => (
                  <ScoreboardDataRow
                    key={b.model_id}
                    b={b}
                    rank={i + 1}
                    barColor={multiModel ? colorByModel.get(b.model_id) : undefined}
                    multiModel={multiModel}
                    maxSpeed={maxSpeed}
                    provider={providerByModel?.get(b.model_id)}
                  />
                ))}
          </tbody>
        </table>
        {!loadingLayout ? (
          <p className="border-t border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted)]">
            {scoreboardSortLine(sort)}
          </p>
        ) : null}
      </div>
      )}
      {!showChart && !loadingLayout && (anyJudgeCap || anyApprox || anyTextOnly) ? (
        <div className="mt-2 space-y-1 text-xs leading-relaxed text-[var(--muted)]">
          {anyJudgeCap ? (
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
    </section>
  );
}
