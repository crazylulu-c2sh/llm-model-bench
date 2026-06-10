import { useMemo } from "react";
import type { ResultRow } from "./ResultsTable";
import { buildModelColorMap } from "../lib/model-color";
import { scoreboardFromRows, type ScoringAggregate } from "../lib/scoreboard";
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

/** 속도 셀: 디코드 TPS 절대 점수(상한 없음) + 열별 최고점 대비 상대 막대 + approx `*`. */
function SpeedCell({ g, max }: { g: SpeedGroup; max: number }) {
  if (g.score == null) return <span className="font-mono text-xs text-[var(--muted)]">—</span>;
  return (
    <span className="inline-flex w-full flex-col items-center leading-tight">
      <span className="font-mono text-xs font-semibold text-[var(--foreground)]">
        {g.score}
        {g.approxRows > 0 ? <Caveat title={APPROX_TITLE} /> : null}
      </span>
      <ScoreBar value={g.score} color="var(--foreground)" max={max} />
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
        풀링. 정렬: 총합 품질순.
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
          속도 = 상한 없는 점수(막대는 각 열 최고점 대비) · 지연 = TTFT ms(낮을수록 좋음)
        </span>
      </div>
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="bg-[var(--surface)] text-[var(--muted)]">
            <tr>
              <th rowSpan={2} className="p-2 align-bottom font-medium">
                모델
              </th>
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
              <th className={`px-2 pb-2 text-center text-[11px] font-normal ${GROUP_BORDER}`} title="정답률·루브릭(0~100)">
                품질
              </th>
              <th className="px-2 pb-2 text-center text-[11px] font-normal" title="디코드 TPS 절대 점수(기준 1000, 상한 없음)">
                속도
              </th>
              <th className="px-2 pb-2 text-center text-[11px] font-normal" title="Time-To-First-Token, 첫 토큰까지 ms(낮을수록 좋음, 점수 비포함)">
                지연
              </th>
              <th className={`px-2 pb-2 text-center text-[11px] font-normal ${GROUP_BORDER}`} title="정답률·루브릭(0~100)">
                품질
              </th>
              <th className="px-2 pb-2 text-center text-[11px] font-normal" title="디코드 TPS 절대 점수(기준 1000, 상한 없음)">
                속도
              </th>
              <th className="px-2 pb-2 text-center text-[11px] font-normal" title="Time-To-First-Token, 첫 토큰까지 ms(낮을수록 좋음, 점수 비포함)">
                지연
              </th>
              <th className={`px-2 pb-2 text-center text-[11px] font-normal ${GROUP_BORDER}`} title="정답률·루브릭(0~100)">
                품질
              </th>
              <th className="px-2 pb-2 text-center text-[11px] font-normal" title="디코드 TPS 절대 점수(기준 1000, 상한 없음)">
                속도
              </th>
              <th className="px-2 pb-2 text-center text-[11px] font-normal" title="Time-To-First-Token, 첫 토큰까지 ms(낮을수록 좋음, 점수 비포함)">
                지연
              </th>
            </tr>
          </thead>
          <tbody>
            {board.map((b, i) => {
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
