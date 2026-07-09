import { isVisionScenario } from "../scenarios-preview";
import { tokensPerSecondFromRun } from "../tps";
import { compareModelIdAlphanumeric } from "../model-sort";
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

/**
 * `buildScoringRows`가 각 행에서 읽는 최소 부분집합. 웹의 `ResultRow`가 이 타입의 구조적
 * 상위집합이므로 웹 호출부는 `ResultRow[]`를 그대로 넘겨도 된다.
 */
export type ScoringResultRow = {
  rowKey: string;
  model_id: string;
  scenario: string;
  api: string;
  ttft_ms: number | null;
  tps?: number | null;
  tps_source?: "usage" | "approx";
  score?: number;
};

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
 * 한 (model, scenario, api)의 모든 측정 런을 평균한 ScoringRow.
 * 웹(`buildScoringRows`)과 서버(`scoringRowsFromBenchDetails`)가 공유하는 유일한 평균 로직 —
 * 두 경로가 동일 수치를 내도록 여기서만 계산한다. runs는 비어 있지 않다고 가정한다.
 */
export function averageRunsToScoringRow(
  model_id: string,
  scenario: string,
  api: string,
  runs: readonly ScoringRunInput[],
): ScoringRow {
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
    if (typeof run.ttft_ms === "number" && Number.isFinite(run.ttft_ms) && run.ttft_ms >= 0) {
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
    if (isJudgeCappedRun(scenario, run)) judgeCapped = true;
  }

  return {
    model_id,
    scenario,
    api,
    ttft_ms: ttftN > 0 ? ttftSum / ttftN : null,
    tps: tpsN > 0 ? tpsSum / tpsN : null,
    tps_source: anyTps ? (allUsage ? "usage" : "approx") : undefined,
    score: scoreN > 0 ? scoreSum / scoreN : null,
    judgeCapped,
  };
}

/**
 * 각 행을 detailAggregate의 모든 측정 런 평균으로 환산한 ScoringRow로 만든다.
 * 런이 없으면 행 자체의 마지막-런 값으로 폴백한다. (웹 Scoreboard 진입점)
 */
export function buildScoringRows(
  rows: readonly ScoringResultRow[],
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
    return averageRunsToScoringRow(r.model_id, r.scenario, r.api, runs);
  });
}

/** 서버 `BenchResultDetail`(run-queries)의 구조적 최소 입력 — 랭킹 계산용. */
export type ScoringBenchDetailInput = {
  meta: { model_id: string };
  scenarios: ReadonlyArray<{
    id: string;
    api_route: string;
    runs: readonly ScoringRunInput[];
  }>;
};

/**
 * 서버 경로: 저장된 벤치 상세들에서 직접 ScoringRow[]를 만든다.
 * 서버는 항상 측정 런을 갖고 있으므로 `averageRunsToScoringRow`(웹과 동일)만 태운다 —
 * 같은 데이터면 브라우저 Scoreboard와 바이트 단위로 동일한 품질·속도가 나온다.
 * `filter`가 주어지면 해당 시나리오만 포함한다(task/카테고리 필터).
 */
export function scoringRowsFromBenchDetails(
  details: readonly ScoringBenchDetailInput[],
  filter?: (scenarioId: string) => boolean,
): ScoringRow[] {
  const out: ScoringRow[] = [];
  for (const d of details) {
    for (const sc of d.scenarios) {
      if (filter && !filter(sc.id)) continue;
      if (!sc.runs || sc.runs.length === 0) continue;
      out.push(averageRunsToScoringRow(d.meta.model_id, sc.id, sc.api_route, sc.runs));
    }
  }
  return out;
}

function cmpNullableDesc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // null은 맨 아래
  if (b == null) return -1;
  return b - a; // 내림차순
}

function emptySpeed(id: string): ModelSpeedScore {
  const g = { score: null, ttftMs: null, scoredRows: 0, approxRows: 0 } as const;
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

/** 행 + detailAggregate → 정렬된 스코어보드 행. (Scoreboard 카드의 진입점) */
export function scoreboardFromRows(
  rows: readonly ScoringResultRow[],
  detailAggregate: ScoringAggregate,
): ScoreboardRow[] {
  return computeScoreboard(buildScoringRows(rows, detailAggregate));
}
