// 스코어보드 "랭킹 막대 그래프"용 순수 데이터 변환.
// 이미 계산된 board(ScoreboardRow[])를 받아 선택 (그룹×지표) 기준 best→worst로
// 랭킹하고, 표와 동일한 밴드색·caveat 규칙을 붙인 차트 datum을 만든다.
import {
  DEFAULT_SCOREBOARD_SORT,
  naturalDir,
  scoreboardMetricValue,
  sortEquals,
  sortScoreboard,
  type ScoreboardRow,
  type ScoreboardSort,
} from "./scoreboard";
import { BAND_COLOR, qualityBand, speedRelativeBand } from "./score-bands";
import { niceCeil } from "./chart-theme";

/** 차트가 그리는 지표. latency는 "낮을수록 좋음/무점수"라 v1 제외(표에만). */
export type ChartMetric = "quality" | "speed";
export type ChartGroup = "text" | "vision" | "agent" | "total";

export type ScoreboardChartDatum = {
  model_id: string;
  /** 선택 지표값(품질 0~100, 속도 절대 점수). 점수 가능한 행 없으면 null. */
  value: number | null;
  /** 널 아닌 행에만 1부터 부여(널이면 0). */
  rank: number;
  isNull: boolean;
  textOnly: boolean;
  /** 품질 지표 + 비전/총합 그룹 + judge_capped일 때만 true(표 QualityCell과 동일 규칙). */
  capped: boolean;
  /** 속도 지표 + 해당 그룹 approx 행 존재 시 true(표 SpeedCell과 동일 규칙). */
  approx: boolean;
  /** 밴드색(품질=절대, 속도=열 최고점 상대). 널은 자리표시(--border). */
  color: string;
};

export type ScoreboardChartData = {
  data: ScoreboardChartDatum[];
  /** 선택 (그룹×지표)의 최고값(속도 상대 밴드·domain 계산용). */
  max: number;
  /** 널 제외 평균(기준선용). 널 아닌 값이 없으면 undefined. */
  average: number | undefined;
  /** Y축 상한. 품질=100, 속도=niceCeil(max). */
  domainMax: number;
};

const NULL_COLOR = "var(--border)";

export function buildScoreboardChartData(
  board: readonly ScoreboardRow[],
  group: ChartGroup,
  metric: ChartMetric,
): ScoreboardChartData {
  const sort: ScoreboardSort = {
    key: { kind: "metric", group, metric },
    dir: naturalDir({ kind: "metric", group, metric }),
  };
  // 기본 선택(총합/품질 desc)이면 재정렬 생략 → computeScoreboard의 속도 tie-break를 보존해
  // 표 기본 뷰와 순서가 정확히 일치한다. 그 외 (그룹×지표)는 표 헤더 클릭과 동일하게 재정렬.
  const ordered = sortEquals(sort, DEFAULT_SCOREBOARD_SORT) ? [...board] : sortScoreboard(board, sort);

  let max = 0;
  for (const b of ordered) {
    const v = scoreboardMetricValue(b, group, metric);
    if (v != null && v > max) max = v;
  }

  let rankCounter = 0;
  let sum = 0;
  let count = 0;
  const data: ScoreboardChartDatum[] = ordered.map((b) => {
    const value = scoreboardMetricValue(b, group, metric);
    const capped =
      metric === "quality" && group !== "text" && b.quality.caveats.includes("judge_capped");
    const approx = metric === "speed" && b.speed[group].approxRows > 0;
    if (value == null) {
      return {
        model_id: b.model_id,
        value: null,
        rank: 0,
        isNull: true,
        textOnly: b.textOnly,
        capped,
        approx,
        color: NULL_COLOR,
      };
    }
    rankCounter += 1;
    sum += value;
    count += 1;
    const color =
      metric === "quality" ? BAND_COLOR[qualityBand(value)] : BAND_COLOR[speedRelativeBand(value, max)];
    return {
      model_id: b.model_id,
      value,
      rank: rankCounter,
      isNull: false,
      textOnly: b.textOnly,
      capped,
      approx,
      color,
    };
  });

  const average = count > 0 ? sum / count : undefined;
  const domainMax = metric === "quality" ? 100 : niceCeil(max);
  return { data, max, average, domainMax };
}

/**
 * 막대를 벤더 그룹으로 안정 재정렬(그룹 내부는 기존 metric 순서 유지, unknown은 맨 뒤).
 * rank는 metric 랭킹 그대로 두고 배열 순서만 바꾼다(같은 벤더 모델이 인접).
 */
export function reorderChartDataByVendor(
  data: readonly ScoreboardChartDatum[],
  vendorOf: (modelId: string) => string,
): ScoreboardChartDatum[] {
  return data
    .map((d, i) => ({ d, i, key: vendorOf(d.model_id) === "unknown" ? "￿" : vendorOf(d.model_id) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i))
    .map((x) => x.d);
}
