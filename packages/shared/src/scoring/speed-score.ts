import { isVisionScenario } from "../scenarios-preview";

/**
 * 속도 점수 = 디코드(출력) TPS 절대 점수. 기준 30 tok/s = base점, 성능에 선형 비례, 상한 없음.
 * 60 tok/s에서 100점 포화하던 구 앵커 방식을 대체 — 빠른 모델 차이가 점수에 드러난다.
 *
 * TTFT는 점수에 넣지 않고 "지연" 열에 raw ms로 따로 표시한다. 300/TTFT 역비례를 합성에 넣으면
 * 체감-불가(~150ms 이하)·측정 노이즈 영역이 점수를 지배하기 때문(고정 오버헤드 분리는 후속 prefill 작업).
 */
export const SPEED_REFERENCE = { tps: 30, base: 1000 } as const;

/** ResultRow(런 평균 후)에서 이 모듈이 읽는 최소 부분집합. */
export type SpeedInput = {
  model_id: string;
  scenario: string;
  ttft_ms: number | null | undefined;
  tps: number | null | undefined;
  tps_source?: "usage" | "approx";
};

/** 한 그룹(text|vision|total)의 절대 속도 점수 + 지연 슬라이스. */
export type SpeedGroup = {
  /** 반올림 속도 점수(디코드 TPS 기준, 상한 없음). null = 점수 가능한 행 없음. */
  score: number | null;
  /** 반올림 raw TTFT 평균(ms). 점수 아님 — "지연" 열 표시용. null = TTFT 행 없음. */
  ttftMs: number | null;
  /** 속도 점수를 낸 행 수(= tps 행 수). */
  scoredRows: number;
  /** 그 중 tps_source==="approx"였던 행 수. */
  approxRows: number;
  /** 시나리오별 디코드 tok/s의 중앙값(미반올림, 표시에서 포맷). null = tps 행 없음.
   *  점수(=평균 tok/s×33.3)와 달리 이상치에 강건한 "대표 속도"를 raw tok/s로 노출. */
  tpsMedian: number | null;
  /** 시나리오별 tok/s 최소·최대(범위 표기용). null = tps 행 없음. */
  tpsMin: number | null;
  tpsMax: number | null;
};

/** 한 모델의 속도 측 3그룹 슬라이스. */
export type ModelSpeedScore = {
  model_id: string;
  text: SpeedGroup;
  /** score=null이면 vision 미실행/미측정 */
  vision: SpeedGroup;
  total: SpeedGroup;
  textOnly: boolean;
  /** 풀링 행 중 하나라도 approx tps였는지. */
  approxCaveat: boolean;
};

/** tps -> 기준 대비 비율(증가). null/NaN/<=0 -> null. */
export function tpsSpeedRatio(tps: number | null | undefined): number | null {
  if (tps == null || !Number.isFinite(tps) || tps <= 0) return null;
  return tps / SPEED_REFERENCE.tps;
}

/** 칸 속도 점수 = base × 기준대비비율. tps 없으면 null(TTFT는 점수에 미반영). */
export function speedScoreForRow(row: SpeedInput): number | null {
  const r = tpsSpeedRatio(row.tps);
  return r == null ? null : SPEED_REFERENCE.base * r;
}

type SpeedAccum = {
  scoreSum: number;
  scoreN: number;
  approx: number;
  ttftSum: number;
  ttftN: number;
  /** 점수를 낸 행들의 raw 디코드 tok/s(중앙값/최소/최대 계산용). */
  tpsValues: number[];
};

function emptySpeed(): SpeedAccum {
  return { scoreSum: 0, scoreN: 0, approx: 0, ttftSum: 0, ttftN: 0, tpsValues: [] };
}

/** 정렬 후 중앙값(짝수 개수는 두 중앙의 평균). 빈 배열 → null. */
function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function speedGroup(a: SpeedAccum): SpeedGroup {
  return {
    score: a.scoreN > 0 ? Math.round(a.scoreSum / a.scoreN) : null,
    ttftMs: a.ttftN > 0 ? a.ttftSum / a.ttftN : null,
    scoredRows: a.scoreN,
    approxRows: a.approx,
    tpsMedian: median(a.tpsValues),
    tpsMin: a.tpsValues.length > 0 ? Math.min(...a.tpsValues) : null,
    tpsMax: a.tpsValues.length > 0 ? Math.max(...a.tpsValues) : null,
  };
}

/**
 * 모델별 절대 속도 점수 + 지연. (model_id로 풀링, 시나리오·API 행을 동일 가중 평균.)
 * 점수는 tps 있는 행, 지연(TTFT)은 ttft 있는 행으로 각각 독립 집계한다.
 * 반환은 조회용 Map(삽입=등장 순서).
 */
export function computeSpeedScores(rows: readonly SpeedInput[]): Map<string, ModelSpeedScore> {
  const order: string[] = [];
  const acc = new Map<
    string,
    { text: SpeedAccum; vision: SpeedAccum; total: SpeedAccum; visionAttempted: boolean; textAttempted: boolean }
  >();

  for (const r of rows) {
    let m = acc.get(r.model_id);
    if (!m) {
      m = {
        text: emptySpeed(),
        vision: emptySpeed(),
        total: emptySpeed(),
        visionAttempted: false,
        textAttempted: false,
      };
      acc.set(r.model_id, m);
      order.push(r.model_id);
    }
    const vision = isVisionScenario(r.scenario);
    if (vision) m.visionAttempted = true;
    else m.textAttempted = true;
    const grp = vision ? m.vision : m.text;

    const s = speedScoreForRow(r);
    if (s != null) {
      const approx = r.tps_source === "approx" ? 1 : 0;
      grp.scoreSum += s;
      grp.scoreN += 1;
      grp.approx += approx;
      grp.tpsValues.push(r.tps!); // s!=null ⟺ tps 유효(양수 유한)
      m.total.scoreSum += s;
      m.total.scoreN += 1;
      m.total.approx += approx;
      m.total.tpsValues.push(r.tps!);
    }

    if (typeof r.ttft_ms === "number" && Number.isFinite(r.ttft_ms) && r.ttft_ms >= 0) {
      grp.ttftSum += r.ttft_ms;
      grp.ttftN += 1;
      m.total.ttftSum += r.ttft_ms;
      m.total.ttftN += 1;
    }
  }

  const out = new Map<string, ModelSpeedScore>();
  for (const id of order) {
    const m = acc.get(id)!;
    out.set(id, {
      model_id: id,
      text: speedGroup(m.text),
      vision: speedGroup(m.vision),
      total: speedGroup(m.total),
      textOnly: !m.visionAttempted && m.textAttempted,
      approxCaveat: m.total.approx > 0,
    });
  }
  return out;
}
