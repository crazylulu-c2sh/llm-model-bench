import {
  AGENT_AES_GROUND_TRUTH,
  AGENT_CHAIN_GROUND_TRUTH,
  AGENT_DOCS_GROUND_TRUTH,
  AGENT_GROUNDING_GROUND_TRUTH,
} from "@llm-bench/shared";
import { extractFirstJsonObject } from "./normalize.js";

/**
 * #105: 에이전트 시나리오 **결정론(LLM-free) 채점**.
 *
 * mock 도구가 캔드 응답을 주므로 "모델이 볼 수 있었던 사실"의 전집합이 우리 손에 있다 →
 * judge 없이 rubric 0~3 을 낼 수 있다. 이전에는 judge 루브릭만 있고 `LLM_JUDGE_ENABLED` 가 꺼져 있어
 * **정체한 런과 완주한 런이 똑같이 0.33** 으로 저장됐다(= 품질 축이 죽어 있었다).
 *
 * 설계 원칙:
 * - **순수 함수**: rubric 숫자와 사유만 돌려준다. `rubricResult()` 변환은 호출부(scenarios.ts)가 한다
 *   — 이렇게 해야 scenarios.ts ↔ 이 모듈의 순환 import 가 생기지 않고 단위 테스트도 쉬워진다.
 * - **빌트인 전용**: 호출부가 `BUILTIN_AGENT_LOOP_IDS` 로 게이트한다. 커스텀 시나리오는 정답이 없으므로
 *   judge 필수 규약을 유지한다(사용자가 자기 통과 기준을 쓰게 두지 않는다).
 * - **도구 사용 증거를 rubric 에 편입**: argDispatch 시나리오(docs/grounding)는 실제로 문서를 읽었는지를
 *   `tool_arg_hits/attempts` 로 확인한다. 가상 corpus 와 결합해 "파라메트릭 회상만으로 만점" 을 차단한다.
 */

export type AgentScoreContext = {
  completionReason?: "completed" | "stall" | "budget_exhausted" | null;
  /** argDispatch 도구 호출 횟수. `null`/`undefined` = 그런 도구가 없는 시나리오(캡 미적용). */
  toolArgAttempts?: number | null;
  /** 그 중 인자가 정확히 매칭된 횟수. */
  toolArgHits?: number | null;
  /** #108 후속: 도구별 실제 호출 횟수(mock 매칭된 것만). `retried` 실측 판정에 쓴다. */
  toolCallCounts?: Record<string, number> | null;
};

export type AgentRubric = { rubric: 0 | 1 | 2 | 3; reason: string };

type Obj = Record<string, unknown>;

// ─── helpers ──────────────────────────────────────────────────────────────────

const lc = (v: unknown): string => (typeof v === "string" ? v.toLowerCase() : "");

/**
 * 숫자 마커는 경계 가드로(`256` 안의 `56` 오탐 방지), 고유명사는 단순 포함으로 판정.
 * 마커 정책상 1차 판정은 고유명사이고 숫자는 보강용이다.
 */
function hasToken(haystack: string, needle: string): boolean {
  if (/^\d+$/.test(needle)) {
    return new RegExp(`(?<![0-9])${needle}(?![0-9])`).test(haystack);
  }
  return haystack.includes(needle);
}

function parseObject(output: string): Obj | null {
  const raw = extractFirstJsonObject(output);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Obj) : null;
  } catch {
    return null;
  }
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * `toolCallCounts` 는 **호출된 도구만** key 로 넣는다(`agent-loop.ts` 의 `if (matched) …set`).
 * 따라서 `counts?.foo ?? null` 은 미호출과 레거시(카운터 필드 자체 없음)를 구분하지 못해
 * `=== 0` 가드가 영원히 죽는다(#113 후속에서 실증). 여기서 둘을 분리한다:
 * - 카운터 객체가 있으면 키 부재 = **미호출 0**
 * - 카운터 객체가 없으면(레거시 런) `null` = 판정 불가 → 캡 미적용
 */
function callCount(counts: Record<string, number> | null | undefined, tool: string): number | null {
  if (!counts) return null;
  return counts[tool] ?? 0;
}

// ─── 시나리오별 채점기 ─────────────────────────────────────────────────────────

/** `{title, summary, sources[]}` AES 카드 — mock_v1. */
function scoreAesCard(o: Obj): AgentRubric {
  const sources = o.sources;
  if (!nonEmptyString(o.title) || !nonEmptyString(o.summary) || !Array.isArray(sources)) {
    return { rubric: 1, reason: "agent_det: schema incomplete" };
  }
  const summary = lc(o.summary);
  if (summary.includes(AGENT_AES_GROUND_TRUTH.errorLeakMarker)) {
    return { rubric: 1, reason: "agent_det: summarized the tool error payload" };
  }
  const hits = AGENT_AES_GROUND_TRUTH.markers.filter((m) => hasToken(summary, m)).length;
  // `sources[]` 는 프롬프트가 요구한 필드다 — 아무 문자열이나 넣는 공짜 점수를 막는다.
  // 단 **형식은 강요하지 않는다**: 페이지 id(`aes`)든 제목(`Advanced Encryption Standard`)이든 통과.
  const sourcesOk = sources.some((s) =>
    AGENT_AES_GROUND_TRUTH.sourceTokens.some((t) => lc(s).includes(t)),
  );
  if (hits >= 2 && sourcesOk) {
    return { rubric: 3, reason: `agent_det: markers=${hits}/3 sources=ok` };
  }
  if (hits >= 2) return { rubric: 2, reason: `agent_det: markers=${hits}/3 sources=weak` };
  return { rubric: 1, reason: `agent_det: markers=${hits}/3 (thin summary)` };
}

/**
 * 예산 변종 — budget_v1. **완주 여부만 본다.**
 *
 * 초판은 `mock_v1` 채점기를 그대로 재사용했다(`baseScenarioId` 별칭). 두 시나리오는 `max_tokens`
 * 640→192 만 다르므로 **같은 내용 감점이 시나리오 2개 × 라우트 2개 = 4번 계상**됐고, 한 모델의
 * 총점이 사실상 `sources[]` 인용 형식 하나로 결정되는 왜곡이 생겼다.
 *
 * 이 시나리오의 목적은 #101 회귀 가드 — **과사고 모델이 좁은 예산 하에서 정체하는가**이다.
 * 그건 `completionReason`(래퍼가 stall/budget_exhausted → 0) 과 카드 스키마 충족 여부로 충분하다.
 * 내용 마커·인용 형식 검사는 같은 스크립트를 쓰는 `mock_v1` 이 이미 재고 있으므로 여기선 보지 않는다.
 */
function scoreBudgetCard(o: Obj): AgentRubric {
  const sources = o.sources;
  if (!nonEmptyString(o.title) || !nonEmptyString(o.summary) || !Array.isArray(sources)) {
    return { rubric: 1, reason: "agent_det: schema incomplete under budget" };
  }
  return { rubric: 3, reason: "agent_det: completed under budget (card schema ok)" };
}

/**
 * `{title, summary, sources[], retried}` 에러 복구 카드 — error_v1.
 *
 * #108 후속: `retried` 를 **자기신고가 아니라 실측**으로 판정한다. retryable 에러가
 * `read_document`(답을 얻으려면 반드시 부르는 첫 도구) 1차 응답에 있으므로,
 * `tool_call_counts.read_document >= 2` 여야 실제로 재시도한 것이다.
 * (초판은 에러가 `wiki_read` 에 있어 워크플로를 단축한 모델은 **에러를 만나지도 못했다**.)
 *
 * 의도적 비대칭: 여기엔 `sources[]` 내용 검사를 넣지 않는다. 이 시나리오가 재는 것은
 * 에러 복구이지 인용 형식이 아니며, 프롬프트가 형식을 요구하지 않으므로 검사를 추가하면
 * 이 PR 이 고치고 있는 바로 그 거짓 음성을 하나 더 만드는 셈이다.
 */
function scoreErrorCard(o: Obj, ctx: AgentScoreContext): AgentRubric {
  const reads = callCount(ctx.toolCallCounts, "read_document");
  // 도구를 아예 안 부르고 환각으로 완주 → 시나리오 미발동. docs/grounding 의 ungrounded 캡과 동일.
  if (reads === 0) {
    return { rubric: 1, reason: "agent_det: no read_document call — ungrounded" };
  }
  const sources = o.sources;
  if (
    !nonEmptyString(o.title) ||
    !nonEmptyString(o.summary) ||
    !Array.isArray(sources) ||
    typeof o.retried !== "boolean"
  ) {
    return { rubric: 1, reason: "agent_det: schema incomplete (retried must be boolean)" };
  }
  const summary = lc(o.summary);
  if (summary.includes(AGENT_AES_GROUND_TRUTH.errorLeakMarker)) {
    return { rubric: 1, reason: "agent_det: summarized the tool error payload" };
  }
  const hits = AGENT_AES_GROUND_TRUTH.markers.filter((m) => hasToken(summary, m)).length;
  if (hits < 2) return { rubric: 1, reason: `agent_det: markers=${hits}/3 (thin summary)` };

  // 실측 재시도(카운터 없으면 판정 불가 → 자기신고로 폴백하되 사유에 표기).
  const actuallyRetried = reads == null ? null : reads >= 2;
  if (actuallyRetried === null) {
    return o.retried === true
      ? { rubric: 3, reason: "agent_det: retried=true (unverified — no tool counter)" }
      : { rubric: 2, reason: "agent_det: retried=false/missing (unverified)" };
  }
  if (actuallyRetried && o.retried === true) {
    return { rubric: 3, reason: `agent_det: retried verified (read_document ×${reads})` };
  }
  if (actuallyRetried) {
    return { rubric: 2, reason: `agent_det: retried ×${reads} but flag not set` };
  }
  if (o.retried === true) {
    // 플래그만 켜고 실제로는 한 번만 부름 = 자기신고 허위.
    return { rubric: 2, reason: `agent_det: retried=true is false (read_document ×${reads})` };
  }
  return { rubric: 2, reason: `agent_det: no retry after error (read_document ×${reads})` };
}

/** `{title, documents[{id,key_fact}], summary}` 멀티문서 다이제스트 — docs_v1 / docs_budget_v1. */
function scoreDocsDigest(o: Obj, ctx: AgentScoreContext): AgentRubric {
  const attempts = ctx.toolArgAttempts;
  // 도구를 아예 안 부르고 답했다 = 그라운딩 없음. 가상 corpus 라 내용도 못 채운다.
  if (typeof attempts === "number" && attempts === 0) {
    return { rubric: 1, reason: "agent_det: no read_document call — ungrounded" };
  }
  const docs = o.documents;
  if (!Array.isArray(docs)) return { rubric: 1, reason: "agent_det: documents[] missing" };

  const expected = Object.keys(AGENT_DOCS_GROUND_TRUTH) as (keyof typeof AGENT_DOCS_GROUND_TRUTH)[];
  const byId = new Map<string, string>();
  for (const d of docs) {
    if (d && typeof d === "object" && !Array.isArray(d)) {
      const e = d as Obj;
      if (typeof e.id === "string") byId.set(e.id, lc(JSON.stringify(e)));
    }
  }
  if (expected.some((id) => !byId.has(id)) || byId.size !== expected.length) {
    return { rubric: 1, reason: `agent_det: document id set mismatch (${[...byId.keys()].sort().join(",")})` };
  }

  let clean = 0;
  for (const id of expected) {
    const body = byId.get(id)!;
    const own = AGENT_DOCS_GROUND_TRUTH[id];
    const hasOwn = own.primary.some((m) => hasToken(body, m));
    // 교차오염: 다른 문서의 1차 마커가 이 항목에 섞였는가.
    const contaminated = expected
      .filter((other) => other !== id)
      .some((other) => AGENT_DOCS_GROUND_TRUTH[other].primary.some((m) => hasToken(body, m)));
    if (hasOwn && !contaminated) clean += 1;
  }

  const hits = typeof ctx.toolArgHits === "number" ? ctx.toolArgHits : null;
  const readAll = hits == null || hits >= expected.length;
  if (clean === expected.length && readAll) {
    return { rubric: 3, reason: `agent_det: attribution ${clean}/${expected.length} reads=${hits ?? "n/a"}` };
  }
  if (clean >= expected.length - 1) {
    return {
      rubric: 2,
      reason: `agent_det: attribution ${clean}/${expected.length} reads=${hits ?? "n/a"}`,
    };
  }
  return { rubric: 1, reason: `agent_det: attribution ${clean}/${expected.length}` };
}

/** `{answers[{id,fact}]}` 그라운딩 — grounding_v1. */
function scoreGrounding(o: Obj, ctx: AgentScoreContext): AgentRubric {
  const attempts = ctx.toolArgAttempts;
  if (typeof attempts === "number" && attempts === 0) {
    return { rubric: 1, reason: "agent_det: no catalog_read call — ungrounded" };
  }
  const answers = o.answers;
  if (!Array.isArray(answers)) return { rubric: 1, reason: "agent_det: answers[] missing" };

  const expected = Object.keys(AGENT_GROUNDING_GROUND_TRUTH) as (keyof typeof AGENT_GROUNDING_GROUND_TRUTH)[];
  const byId = new Map<string, string>();
  for (const a of answers) {
    if (a && typeof a === "object" && !Array.isArray(a)) {
      const e = a as Obj;
      if (typeof e.id === "string") byId.set(e.id, lc(JSON.stringify(e)));
    }
  }
  // id 는 불투명 문자열이라 **완전일치**만 인정한다(절단·환각 탐지).
  const idHits = expected.filter((id) => byId.has(id)).length;
  if (idHits === 0) return { rubric: 0, reason: "agent_det: no exact record id (hallucinated/truncated)" };

  const factHits = expected.filter((id) => {
    const body = byId.get(id);
    if (!body) return false;
    return AGENT_GROUNDING_GROUND_TRUTH[id].primary.some((m) => hasToken(body, m));
  }).length;

  const hits = typeof ctx.toolArgHits === "number" ? ctx.toolArgHits : null;
  const readAll = hits == null || hits >= expected.length;
  if (idHits === expected.length && factHits === expected.length && readAll) {
    return { rubric: 3, reason: `agent_det: ids ${idHits}/2 facts ${factHits}/2 reads=${hits ?? "n/a"}` };
  }
  if (idHits === expected.length && factHits >= 1) {
    return { rubric: 2, reason: `agent_det: ids ${idHits}/2 facts ${factHits}/2 reads=${hits ?? "n/a"}` };
  }
  return { rubric: 1, reason: `agent_det: ids ${idHits}/2 facts ${factHits}/2` };
}

/** chain 항목 판정 라벨 — reason 문자열 규격이자 재측정 스크립트의 집계 키. */
type ChainVerdict = "ok" | "hallucinated" | "wrong" | "abstained" | "missing";

function chainItemObj(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

/** 답이 superseded(오답) 후보를 따라간 흔적인가 — record_id 든 ref 든 하나만 걸리면 환각. */
function followedSuperseded(item: Obj): boolean {
  const rid = lc(item.record_id).trim();
  const ref = lc(item.ref).trim();
  return (
    AGENT_CHAIN_GROUND_TRUTH.supersededRecordIds.some((x) => rid === x.toLowerCase()) ||
    AGENT_CHAIN_GROUND_TRUTH.supersededRefs.some((x) => ref === x.toLowerCase())
  );
}

/**
 * `{results:[선택항목, 기권항목]}` — chain_v1 (**방해 후보 + 기권**).
 *
 * 초판(3홉 순수 체이닝)의 사다리는 **비단조**였다: `ref` 불일치는 0, 스키마 미완은 1 —
 * 즉 정답 필드를 하나 더 채우면 점수가 내려갔다(실측에서 한 모델이 이 경로로 위로 오채점됐다).
 * 여기서는 **맞은 항목 수**만으로 사다리를 만들어 그 클래스의 버그를 구조적으로 없앤다.
 *
 * - 항목1(선택): active 후보의 `record_id` 완전일치 + `fact` 에 그 레코드 고유 마커 → 정답.
 *   `ref` 는 **판정하지 않는다**(초판 비단조의 진원지이자, 정답을 가리키는 필드가 이미 둘 있다).
 * - 항목2(기권): `abstained === true` → 정답. superseded 레코드를 읽고 답을 지어내면 `hallucinated`.
 *
 * reason 규격: `agent_det: select=<verdict> abstain=<verdict> correct=N/2`.
 */
function scoreChain(o: Obj, ctx: AgentScoreContext): AgentRubric {
  const results = o.results;
  if (!Array.isArray(results) || results.length !== 2) {
    const n = Array.isArray(results) ? `len=${results.length}` : "missing";
    return { rubric: 1, reason: `agent_det: results[] ${n} (expected 2)` };
  }

  // ── 항목1: 유일한 active 후보를 골랐는가 ──────────────────────────────────
  const first = chainItemObj(results[0]);
  let select: ChainVerdict;
  if (!first) {
    select = "missing";
  } else if (first.abstained === true) {
    // active 후보가 실재하는 조회에서 기권 = 과소신뢰 오답.
    select = "abstained";
  } else if (
    lc(first.record_id).trim() === AGENT_CHAIN_GROUND_TRUTH.activeRecordId &&
    AGENT_CHAIN_GROUND_TRUTH.factMarkers.some((m) => hasToken(lc(first.fact), m))
  ) {
    select = "ok";
  } else if (followedSuperseded(first)) {
    select = "hallucinated";
  } else {
    select = "wrong";
  }

  // ── 항목2: active 후보가 없으니 기권했는가 ────────────────────────────────
  const second = chainItemObj(results[1]);
  let abstain: ChainVerdict;
  if (!second) {
    abstain = "missing";
  } else if (second.abstained === true) {
    abstain = "ok";
  } else if (followedSuperseded(second)) {
    // 함정 발동: resolve/fetch 가 성공을 돌려주니 그럴듯한 오답이 만들어진다.
    abstain = "hallucinated";
  } else {
    abstain = "wrong";
  }

  const correct = (select === "ok" ? 1 : 0) + (abstain === "ok" ? 1 : 0);
  const reason = `agent_det: select=${select} abstain=${abstain} correct=${correct}/2`;

  // 마지막 홉 미도달 = 근거 없이 낸 답. 카운터가 없는 레거시 런에는 적용하지 않는다.
  if (callCount(ctx.toolCallCounts, "fetch") === 0) {
    return { rubric: 1, reason: `${reason} (fetch not called — ungrounded)` };
  }
  if (correct === 2) return { rubric: 3, reason };
  if (correct === 1) return { rubric: 2, reason };
  return { rubric: 1, reason };
}

const SCORERS: Record<string, (o: Obj, ctx: AgentScoreContext) => AgentRubric> = {
  agent_loop_mock_v1: (o) => scoreAesCard(o),
  agent_loop_budget_v1: (o) => scoreBudgetCard(o),
  agent_loop_error_v1: scoreErrorCard,
  agent_loop_docs_v1: scoreDocsDigest,
  agent_loop_grounding_v1: scoreGrounding,
  agent_loop_chain_v1: scoreChain,
};

/** 이 시나리오에 결정론 채점기가 있는가(가드 테스트가 BUILTIN_AGENT_LOOP_IDS 전수 검사에 사용). */
export function hasAgentScorer(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(SCORERS, id);
}

/**
 * 결정론 채점. 대상이 아니면 `null`(호출부가 기존 경로로 폴백).
 * 정체·예산소진은 **본문과 무관하게 rubric 0** — 최종 답을 못 낸 런이 만점 런과 같은 값으로
 * 저장되던 사실오류를 여기서 고친다.
 */
export function scoreAgentScenario(
  id: string,
  output: string,
  ctx?: AgentScoreContext,
): AgentRubric | null {
  const scorer = SCORERS[id];
  if (!scorer) return null;

  const reason = ctx?.completionReason;
  if (reason === "stall" || reason === "budget_exhausted") {
    return { rubric: 0, reason: `agent_det: ${reason} — no final answer` };
  }
  const obj = parseObject(output);
  if (!obj) return { rubric: 0, reason: "agent_det: no valid JSON object" };
  return scorer(obj, ctx ?? {});
}
