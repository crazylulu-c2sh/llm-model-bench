import { isVisionScenario } from "@llm-bench/shared";
import { TPS_TIER_THRESHOLDS } from "./tps-tier";

/**
 * TPS 앵커(tok/s -> 0~100, 증가). 내부 분기점은 TPS_TIER_THRESHOLDS(okay/good/fast) 그대로 재사용해
 * 점수와 tier UI가 어긋나지 않는다. 60(=2×fast)에서 포화 — 이후는 읽기 속도를 추월해 체감 차이가 없다.
 */
export const TPS_SCORE_ANCHORS: ReadonlyArray<readonly [tps: number, points: number]> = [
  [0, 0],
  [TPS_TIER_THRESHOLDS.okay, 40], // 5  -> 40 (채택가능)
  [TPS_TIER_THRESHOLDS.good, 70], // 15 -> 70 (쓸만)
  [TPS_TIER_THRESHOLDS.fast, 90], // 30 -> 90 (쾌적)
  [60, 100],
];

/**
 * TTFT 앵커(ms -> 0~100, 감소). 상호작용 지연 규범(Nielsen 변형: ~300ms 즉각, ~1s 흐름 유지, ~10s 이탈).
 */
export const TTFT_SCORE_ANCHORS: ReadonlyArray<readonly [ms: number, points: number]> = [
  [300, 100],
  [800, 85],
  [2000, 60],
  [5000, 20],
  [10000, 0],
];

/** 두 메트릭이 모두 있을 때의 가중치. 하나가 결측이면 있는 쪽으로 재정규화. */
export const SPEED_WEIGHTS = { tps: 0.7, ttft: 0.3 } as const;

/** ResultRow(런 평균 후)에서 이 모듈이 읽는 최소 부분집합. */
export type SpeedInput = {
  model_id: string;
  scenario: string;
  ttft_ms: number | null | undefined;
  tps: number | null | undefined;
  tps_source?: "usage" | "approx";
};

/** 한 그룹(text|vision|total)의 절대 속도 점수 슬라이스. null = "—"(점수 가능한 행 없음). */
export type SpeedGroup = {
  /** 반올림 0~100. */
  score: number | null;
  /** 속도 점수를 낸 행 수. */
  scoredRows: number;
  /** 그 중 tps_source==="approx"였던 행 수. */
  approxRows: number;
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

/** 정렬 오름차순 [x, points] 앵커에 대한 piecewise-linear 보간(범위 밖은 클램프). */
export function interpAnchors(x: number, anchors: ReadonlyArray<readonly [number, number]>): number {
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i]!;
    const [x0, y0] = anchors[i - 1]!;
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/** tps -> 0~100 (증가). null/NaN/<=0 -> null. */
export function tpsToSpeedPoints(tps: number | null | undefined): number | null {
  if (tps == null || !Number.isFinite(tps) || tps <= 0) return null;
  return interpAnchors(tps, TPS_SCORE_ANCHORS);
}

/** ttft_ms -> 0~100 (감소). null/NaN/<=0 -> null(0ms는 측정 아티팩트라 100 아님). */
export function ttftToSpeedPoints(ttft: number | null | undefined): number | null {
  if (ttft == null || !Number.isFinite(ttft) || ttft <= 0) return null;
  return interpAnchors(ttft, TTFT_SCORE_ANCHORS);
}

/** 칸 속도 점수(합성 + 결측 재정규화). 둘 다 결측이면 null(평균에서 제외). */
export function speedScoreForRow(row: SpeedInput): number | null {
  const tpsPts = tpsToSpeedPoints(row.tps);
  const ttftPts = ttftToSpeedPoints(row.ttft_ms);
  if (tpsPts == null && ttftPts == null) return null;
  if (tpsPts == null) return ttftPts;
  if (ttftPts == null) return tpsPts;
  return SPEED_WEIGHTS.tps * tpsPts + SPEED_WEIGHTS.ttft * ttftPts;
}

type SpeedAccum = { sum: number; n: number; approx: number };

function emptySpeed(): SpeedAccum {
  return { sum: 0, n: 0, approx: 0 };
}

function speedGroup(a: SpeedAccum): SpeedGroup {
  return { score: a.n > 0 ? Math.round(a.sum / a.n) : null, scoredRows: a.n, approxRows: a.approx };
}

/**
 * 모델별 절대 속도 점수. (model_id로 풀링, 시나리오·API 행을 동일 가중 평균.)
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

    const s = speedScoreForRow(r);
    if (s == null) continue;
    const approx = r.tps_source === "approx" ? 1 : 0;
    const grp = vision ? m.vision : m.text;
    grp.sum += s;
    grp.n += 1;
    grp.approx += approx;
    m.total.sum += s;
    m.total.n += 1;
    m.total.approx += approx;
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
