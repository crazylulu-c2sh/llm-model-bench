import { isVisionScenario } from "@llm-bench/shared";
import type { ResultRow } from "../components/ResultsTable";
import { tokensPerSecondFromRun } from "../components/chart-types";
import { compareModelIdAlphanumeric } from "./model-sort";
import { computeQualityScores, type ModelQualityScore } from "./quality-score";
import { computeSpeedScores, type ModelSpeedScore } from "./speed-score";

/** detailAggregate 런의 최소 부분집합(측정 런 평균 계산용). */
export type ScoringRunInput = {
  ttft_ms: number | null;
  total_ms: number;
  output_text: string;
  usage_output_tokens?: number | null;
  quality?: { pass: boolean; score?: number; reason?: string };
};

/** Scoreboard가 받는 detailAggregate 형태(필요한 부분만). */
export type ScoringAggregate = Record<string, { runs?: readonly ScoringRunInput[] } | undefined>;

/** 한 (model, scenario, api)에 대한 측정 런 평균 결과 — 품질·속도 모듈 공통 입력. */
export type ScoringRow = {
  model_id: string;
  scenario: string;
  api: string;
  ttft_ms: number | null;
  tps: number | null;
  tps_source?: "usage" | "approx";
  score: number | null;
  judgeCapped: boolean;
};

/** 스코어보드 한 행: 한 모델의 품질·속도 3그룹 + text-only. */
export type ScoreboardRow = {
  model_id: string;
  quality: ModelQualityScore;
  speed: ModelSpeedScore;
  /** vision 미실행 → 두 측 모두 text-only. */
  textOnly: boolean;
};

const JUDGE_CAP_REASON_PREFIX = "prefilter passed";

/** LLM_JUDGE_ENABLED 없이 rubric 1로 캡된 vision 런인지(점수 평균 후엔 0.33이 사라지므로 런 단위 판정). */
function isJudgeCappedRun(scenario: string, run: ScoringRunInput): boolean {
  return (
    isVisionScenario(scenario) &&
    run.quality?.score === 0.33 &&
    (run.quality?.reason ?? "").startsWith(JUDGE_CAP_REASON_PREFIX)
  );
}

/**
 * 각 ResultRow를 detailAggregate의 모든 측정 런 평균으로 환산한 ScoringRow로 만든다.
 * 런이 없으면 ResultRow의 마지막-런 값으로 폴백한다.
 */
export function buildScoringRows(
  rows: readonly ResultRow[],
  detailAggregate: ScoringAggregate,
): ScoringRow[] {
  return rows.map((r) => {
    const runs = detailAggregate[r.rowKey]?.runs ?? [];
    if (runs.length === 0) {
      return {
        model_id: r.model_id,
        scenario: r.scenario,
        api: r.api,
        ttft_ms: r.ttft_ms,
        tps: r.tps ?? null,
        tps_source: r.tps_source,
        score: typeof r.score === "number" && Number.isFinite(r.score) ? r.score : null,
        judgeCapped: false,
      };
    }

    let ttftSum = 0;
    let ttftN = 0;
    let tpsSum = 0;
    let tpsN = 0;
    let scoreSum = 0;
    let scoreN = 0;
    let anyTps = false;
    let allUsage = true;
    let judgeCapped = false;

    for (const run of runs) {
      if (typeof run.ttft_ms === "number" && Number.isFinite(run.ttft_ms) && run.ttft_ms > 0) {
        ttftSum += run.ttft_ms;
        ttftN += 1;
      }
      const tps = tokensPerSecondFromRun(run.total_ms, run.output_text, run.usage_output_tokens);
      if (tps > 0) {
        tpsSum += tps;
        tpsN += 1;
        anyTps = true;
        if (!(run.usage_output_tokens != null && run.usage_output_tokens > 0)) allUsage = false;
      }
      const s = run.quality?.score;
      if (typeof s === "number" && Number.isFinite(s)) {
        scoreSum += s;
        scoreN += 1;
      }
      if (isJudgeCappedRun(r.scenario, run)) judgeCapped = true;
    }

    return {
      model_id: r.model_id,
      scenario: r.scenario,
      api: r.api,
      ttft_ms: ttftN > 0 ? ttftSum / ttftN : null,
      tps: tpsN > 0 ? tpsSum / tpsN : null,
      tps_source: anyTps ? (allUsage ? "usage" : "approx") : undefined,
      score: scoreN > 0 ? scoreSum / scoreN : null,
      judgeCapped,
    };
  });
}

function cmpNullableDesc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // null은 맨 아래
  if (b == null) return -1;
  return b - a; // 내림차순
}

function emptySpeed(id: string): ModelSpeedScore {
  const g = { score: null, scoredRows: 0, approxRows: 0 } as const;
  return { model_id: id, text: g, vision: g, total: g, textOnly: false, approxCaveat: false };
}

/**
 * 품질·속도 모듈을 모델별로 합쳐 스코어보드 행으로 만든 뒤 정렬한다.
 * 기본 정렬: total 품질 desc → total 속도 desc → 모델 id(alphanumeric). null은 맨 아래.
 */
export function computeScoreboard(scoringRows: readonly ScoringRow[]): ScoreboardRow[] {
  const quality = computeQualityScores(scoringRows);
  const speed = computeSpeedScores(scoringRows);

  const out: ScoreboardRow[] = quality.map((q) => {
    const s = speed.get(q.model_id) ?? emptySpeed(q.model_id);
    return { model_id: q.model_id, quality: q, speed: s, textOnly: q.textOnly && s.textOnly };
  });

  out.sort(
    (a, b) =>
      cmpNullableDesc(a.quality.total.value, b.quality.total.value) ||
      cmpNullableDesc(a.speed.total.score, b.speed.total.score) ||
      compareModelIdAlphanumeric(a.model_id, b.model_id),
  );
  return out;
}

/** ResultRow[] + detailAggregate → 정렬된 스코어보드 행. (Scoreboard 카드의 진입점) */
export function scoreboardFromRows(
  rows: readonly ResultRow[],
  detailAggregate: ScoringAggregate,
): ScoreboardRow[] {
  return computeScoreboard(buildScoringRows(rows, detailAggregate));
}
