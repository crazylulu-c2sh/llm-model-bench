import { isAgentScenario, isVisionScenario } from "../scenarios-preview";

/** 점수 신뢰도 경고 플래그(silent 금지). */
export type QualityCaveat = "judge_capped" | "vision_partial" | "no_quality_data";

/** 한 그룹(text|vision|agent|total)의 절대 품질 점수 슬라이스. */
export type QualityGroupScore = {
  /** 0~100 평균(미반올림). 점수 가능한 행이 없으면 null("—"). */
  value: number | null;
  /** 유한 score를 낸 distinct 시나리오 수(분자 커버리지). */
  covered: number;
  /** 이 그룹에서 시도된 distinct 시나리오 수(분모). */
  expected: number;
};

/** 한 모델의 품질 측 4그룹 슬라이스. */
export type ModelQualityScore = {
  model_id: string;
  text: QualityGroupScore;
  /** value=null이면 "—"(N/A) */
  vision: QualityGroupScore;
  /** value=null이면 "—"(N/A) — 멀티턴 에이전트 시나리오(`agent_*`). */
  agent: QualityGroupScore;
  total: QualityGroupScore;
  /** 비전·에이전트 미실행 → total이 텍스트 전용("text-only"). */
  textOnly: boolean;
  caveats: QualityCaveat[];
  /** judge OFF로 rubric 캡된 vision/agent 시나리오 수(caveat 상세). */
  judgeCappedScenarios: number;
};

/** ResultRow(런 평균 후)에서 이 모듈이 읽는 최소 부분집합. */
export type QualityInput = {
  model_id: string;
  scenario: string;
  /** 측정 런 평균 품질 점수(0~1). */
  score: number | null | undefined;
  /** 어떤 측정 런이 LLM_JUDGE_ENABLED 없이 rubric 캡됐는지(런 단위 판정). */
  judgeCapped?: boolean;
};

function isFiniteScore(s: number | null | undefined): s is number {
  return typeof s === "number" && Number.isFinite(s);
}

type GroupAccum = {
  /** 유한 score 합 */
  sum: number;
  /** 유한 score 행 수(평균 분모) */
  n: number;
  /** 유한 score를 낸 distinct 시나리오 */
  scored: Set<string>;
  /** 행이 존재한(시도된) distinct 시나리오 */
  attempted: Set<string>;
};

function emptyAccum(): GroupAccum {
  return { sum: 0, n: 0, scored: new Set(), attempted: new Set() };
}

function groupScore(a: GroupAccum): QualityGroupScore {
  return {
    value: a.n > 0 ? (a.sum / a.n) * 100 : null,
    covered: a.scored.size,
    expected: a.attempted.size,
  };
}

/**
 * 모델별 절대 품질 점수.
 * - Text/Vision = 카테고리 내 (시나리오·API) 행의 score 평균 ×100(텍스트는 0/1이라 통과율).
 * - Total = 모든 행을 동일 가중으로 풀링한 평균 ×100 (avg(text,vision)이 아님).
 * - score가 유한이 아니면(미채점) 분자·분모에서 제외. score===0(실패)은 포함.
 * - 입력 모델 등장 순서를 보존한 배열로 반환.
 */
export function computeQualityScores(rows: readonly QualityInput[]): ModelQualityScore[] {
  const order: string[] = [];
  const byModel = new Map<
    string,
    { text: GroupAccum; vision: GroupAccum; agent: GroupAccum; total: GroupAccum; judgeCapped: Set<string> }
  >();

  for (const r of rows) {
    let m = byModel.get(r.model_id);
    if (!m) {
      m = {
        text: emptyAccum(),
        vision: emptyAccum(),
        agent: emptyAccum(),
        total: emptyAccum(),
        judgeCapped: new Set(),
      };
      byModel.set(r.model_id, m);
      order.push(r.model_id);
    }
    const vision = isVisionScenario(r.scenario);
    const agent = isAgentScenario(r.scenario);
    const grp = vision ? m.vision : agent ? m.agent : m.text;
    grp.attempted.add(r.scenario);
    m.total.attempted.add(r.scenario);
    if (isFiniteScore(r.score)) {
      grp.sum += r.score;
      grp.n += 1;
      grp.scored.add(r.scenario);
      m.total.sum += r.score;
      m.total.n += 1;
      m.total.scored.add(r.scenario);
    }
    // judge OFF rubric 캡은 vision·agent 모두 rubric 채점이라 대상(text는 0/1 통과율이라 무관).
    if (r.judgeCapped && (vision || agent)) m.judgeCapped.add(r.scenario);
  }

  return order.map((id) => {
    const m = byModel.get(id)!;
    const text = groupScore(m.text);
    const vision = groupScore(m.vision);
    const agent = groupScore(m.agent);
    const total = groupScore(m.total);
    const textOnly = vision.expected === 0 && agent.expected === 0 && text.expected > 0;
    const caveats: QualityCaveat[] = [];
    if (m.judgeCapped.size > 0) caveats.push("judge_capped");
    if (vision.expected > 0 && vision.covered < vision.expected) caveats.push("vision_partial");
    if (total.value === null) caveats.push("no_quality_data");
    return {
      model_id: id,
      text,
      vision,
      agent,
      total,
      textOnly,
      caveats,
      judgeCappedScenarios: m.judgeCapped.size,
    };
  });
}
