import { useMemo, useState } from "react";
import { ArrowDown, ArrowDownUp, ArrowUp } from "lucide-react";
import type { ResultRow } from "./ResultsTable";
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
  type ScoringAggregate,
  type SortDir,
} from "../lib/scoreboard";
import type { QualityGroupScore } from "../lib/quality-score";
import type { SpeedGroup } from "../lib/speed-score";

const CAP_TITLE =
  "비전 meme/wireframe rubric이 LLM_JUDGE_ENABLED=1 없이 캡됨 — 비전·총합 품질이 낮게 나올 수 있음";
const APPROX_TITLE = "provider가 usage 토큰을 안 줘 chars/4 추정(approx) — CJK·코드에서 오차 큼";

/** 절대 점수 밴드 → 색(기존 tps-tier 토큰 재사용; 비교 상대값 아님). */
type ScoreBand = "high" | "good" | "mid" | "low";
const BAND_COLOR: Record<ScoreBand, string> = {
  high: "var(--tier-fast)", // 초록
  good: "var(--tier-good)", // 노랑
  mid: "var(--tier-okay)", // 주황
  low: "var(--tier-slow)", // 빨강
};
/** 품질 밴드: ≥90 / 70~89 / 50~69 / <50. */
function qualityBand(v: number): ScoreBand {
  if (v >= 90) return "high";
  if (v >= 70) return "good";
  if (v >= 50) return "mid";
  return "low";
}
/** 속도 밴드(상대): 상한 없는 점수라 절대 임계 대신 열 내 최고점 대비 비율로 색칠. ≥0.9 / 0.75 / 0.5. */
function speedRelativeBand(value: number, max: number): ScoreBand {
  const r = max > 0 ? value / max : 0;
  if (r >= 0.9) return "high";
  if (r >= 0.75) return "good";
  if (r >= 0.5) return "mid";
  return "low";
}
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

/** 속도 셀: 디코드 TPS 절대 점수(상한 없음) + 열별 최고점 대비 상대 막대·색 + approx `*`. */
function SpeedCell({ g, max }: { g: SpeedGroup; max: number }) {
  if (g.score == null) return <span className="font-mono text-xs text-[var(--muted)]">—</span>;
  const color = BAND_COLOR[speedRelativeBand(g.score, max)];
  return (
    <span className="inline-flex w-full flex-col items-center leading-tight">
      <span className="font-mono text-xs font-semibold" style={{ color }}>
        {g.score}
        {g.approxRows > 0 ? <Caveat title={APPROX_TITLE} /> : null}
      </span>
      <ScoreBar value={g.score} color={color} max={max} />
    </span>
  );
}

/** 지연 셀: raw TTFT 평균(ms, 낮을수록 좋음). 점수·막대·밴드 없음. */
function TtftCell({ g }: { g: SpeedGroup }) {
  return g.ttftMs == null ? (
    <span className="font-mono text-xs text-[var(--muted)]">—</span>
  ) : (
    <span className="font-mono text-xs text-[var(--muted)]">{g.ttftMs}ms</span>
  );
}

const GROUP_BORDER = "border-l border-[var(--border)]";

const GROUP_LABEL: Record<ScoreGroup, string> = { text: "텍스트", vision: "비전", total: "총합" };
const METRIC_LABEL: Record<ScoreMetric, string> = { quality: "품질", speed: "속도", latency: "지연" };
const METRIC_TITLE: Record<ScoreMetric, string> = {
  quality: "정답률·루브릭(0~100)",
  speed: "디코드 TPS 절대 점수(기준 1000, 상한 없음)",
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

/**
 * 모델별 텍스트/비전/총합 리더보드 — 품질(0~100) · 속도(상한 없는 디코드 TPS 절대 점수) · 지연(TTFT ms).
 * 점수는 모든 측정 런 평균으로 산출하며 표·차트 위에 요약으로 표시한다.
 */
export function Scoreboard({
  rows,
  detailAggregate,
  title = "스코어보드",
}: {
  rows: ResultRow[];
  detailAggregate: ScoringAggregate;
  title?: string;
}) {
  const board = useMemo(() => scoreboardFromRows(rows, detailAggregate), [rows, detailAggregate]);
  const [sort, setSort] = useState<ScoreboardSort>(DEFAULT_SCOREBOARD_SORT);
  function onSortClick(key: ScoreboardSortKey) {
    setSort((prev) =>
      sameSortKey(prev.key, key)
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } // 같은 컬럼 → 방향 토글
        : { key, dir: naturalDir(key) }, // 새 컬럼 → 자연 기본 방향
    );
  }
  // 기본 정렬이면 재정렬 생략 → computeScoreboard의 3단계 순서(총합 속도 tie-break 포함) 그대로 유지.
  const sortedBoard = useMemo(
    () => (sortEquals(sort, DEFAULT_SCOREBOARD_SORT) ? board : sortScoreboard(board, sort)),
    [board, sort],
  );
  const colorByModel = useMemo(() => buildModelColorMap(rows.map((r) => r.model_id)), [rows]);
  // 속도 막대는 각 열(텍스트/비전/총합) 최고 속도점 대비 상대 길이 — 열별 max를 미리 구한다.
  const maxSpeed = useMemo(() => {
    const m = { text: 0, vision: 0, total: 0 };
    for (const b of board) {
      if (b.speed.text.score != null) m.text = Math.max(m.text, b.speed.text.score);
      if (b.speed.vision.score != null) m.vision = Math.max(m.vision, b.speed.vision.score);
      if (b.speed.total.score != null) m.total = Math.max(m.total, b.speed.total.score);
    }
    return m;
  }, [board]);

  if (rows.length === 0 || board.length === 0) return null;

  const multiModel = colorByModel.size >= 2;
  const anyJudgeCap = board.some((b) => b.quality.caveats.includes("judge_capped"));
  const anyApprox = board.some((b) => b.speed.approxCaveat);
  const anyTextOnly = board.some((b) => b.textOnly);

  return (
    <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
      <h2 className="mb-1 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--foreground)]">
        {title}
      </h2>
      <p className="mb-2 text-xs text-[var(--muted)]">
        품질은 절대 점수(0~100), 속도는 상한 없는 디코드 TPS 절대 점수(기준 30 tok/s = 1000). 지연(TTFT)은 첫
        토큰까지 ms로 낮을수록 좋음(점수 미포함). 측정 런 평균 · 텍스트/비전은 시나리오 동일 가중, 총합은 전체
        풀링. 헤더를 눌러 정렬.
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
          속도 = 상한 없는 점수(막대 길이·색 모두 각 열 최고점 대비 상대) · 지연 = TTFT ms(낮을수록 좋음)
        </span>
      </div>
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full min-w-[46rem] text-left text-sm">
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
                총합
              </th>
            </tr>
            <tr>
              <GroupSortHeaders group="text" sort={sort} onSort={onSortClick} />
              <GroupSortHeaders group="vision" sort={sort} onSort={onSortClick} />
              <GroupSortHeaders group="total" sort={sort} onSort={onSortClick} />
            </tr>
          </thead>
          <tbody>
            {sortedBoard.map((b, i) => {
              const cap = b.quality.caveats.includes("judge_capped");
              const barColor = multiModel ? colorByModel.get(b.model_id) : undefined;
              return (
                <tr key={b.model_id} className="border-t border-[var(--border)]">
                  <td className="relative p-2">
                    {barColor ? (
                      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: barColor }} aria-hidden />
                    ) : null}
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-xs">
                      <span className="text-[var(--muted)]">{i + 1}.</span>
                      {multiModel && barColor ? (
                        <span className="size-2 shrink-0 rounded-full" style={{ background: barColor }} aria-hidden />
                      ) : null}
                      <span className="text-[var(--foreground)]">{b.model_id}</span>
                      {b.textOnly ? (
                        <span
                          className="rounded border border-[var(--border)] px-1 py-px text-[10px] text-[var(--muted)]"
                          title="비전 시나리오 미실행 — 총합은 텍스트 점수와 동일"
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
            })}
          </tbody>
        </table>
        <p className="border-t border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted)]">
          {scoreboardSortLine(sort)}
        </p>
      </div>
      {anyJudgeCap || anyApprox || anyTextOnly ? (
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
