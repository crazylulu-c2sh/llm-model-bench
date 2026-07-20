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
 * 예산 변종은 본체와 스크립트가 같으므로 같은 채점기를 쓴다.
 *
 * (docs 예산 변종은 실측 결과 도입하지 않았다 — max_tokens 384→160 6개 값 전부에서
 * `google/gemma-4-26b-a4b-qat` 가 정체 없이 완주했다. 이 모델의 과사고는 **과업 의존적**이라
 * 짧은 AES 카드에서는 예산을 사고로 태우지만 멀티문서 다이제스트에서는 내용을 바로 낸다.)
 */
function baseScenarioId(id: string): string {
  if (id === "agent_loop_budget_v1") return "agent_loop_mock_v1";
  return id;
}

// ─── 시나리오별 채점기 ─────────────────────────────────────────────────────────

/** `{title, summary, sources[]}` AES 카드 — mock_v1 / budget_v1. */
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
  const reads = ctx.toolCallCounts?.read_document ?? null;
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

/**
 * `{ref, record_id, fact}` 3홉 체인 — chain_v1.
 *
 * 최종 답이 세 홉의 산출물을 각각 요구하므로, 어느 홉을 건너뛰면 그 필드를 채울 수 없다.
 * reason 은 **`hop=N` 규격으로 고정**한다 — 재측정 스크립트가 "어디서 끊겼는지"를 바로 집계한다.
 */
function scoreChain(o: Obj, ctx: AgentScoreContext): AgentRubric {
  const fetches = ctx.toolCallCounts?.fetch ?? null;
  // 마지막 홉 미도달 = 체인 미완성. docs/grounding 의 ungrounded 캡과 같은 패턴.
  if (fetches === 0) {
    return { rubric: 1, reason: "agent_det: hop=3 fetch not called — ungrounded" };
  }
  if (!nonEmptyString(o.ref) || !nonEmptyString(o.record_id) || !nonEmptyString(o.fact)) {
    return { rubric: 1, reason: "agent_det: hop=0 schema incomplete" };
  }
  // 불투명 토큰이라 완전일치만 인정(절단·환각 탐지).
  if (o.ref.trim() !== AGENT_CHAIN_GROUND_TRUTH.ref) {
    return { rubric: 0, reason: `agent_det: hop=1 ref mismatch (${o.ref.slice(0, 24)})` };
  }
  if (o.record_id.trim() !== AGENT_CHAIN_GROUND_TRUTH.recordId) {
    return { rubric: 1, reason: `agent_det: hop=2 record_id mismatch (${o.record_id.slice(0, 24)})` };
  }
  const fact = lc(o.fact);
  const factOk = AGENT_CHAIN_GROUND_TRUTH.factMarkers.some((m) => hasToken(fact, m));
  if (!factOk) return { rubric: 2, reason: "agent_det: hop=3 fact weak" };
  return { rubric: 3, reason: `agent_det: hop=3 ok (chain complete, fetch ×${fetches ?? "n/a"})` };
}

const SCORERS: Record<string, (o: Obj, ctx: AgentScoreContext) => AgentRubric> = {
  agent_loop_mock_v1: (o) => scoreAesCard(o),
  agent_loop_error_v1: scoreErrorCard,
  agent_loop_docs_v1: scoreDocsDigest,
  agent_loop_grounding_v1: scoreGrounding,
  agent_loop_chain_v1: scoreChain,
};

/** 이 시나리오에 결정론 채점기가 있는가(가드 테스트가 BUILTIN_AGENT_LOOP_IDS 전수 검사에 사용). */
export function hasAgentScorer(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(SCORERS, baseScenarioId(id));
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
  const scorer = SCORERS[baseScenarioId(id)];
  if (!scorer) return null;

  const reason = ctx?.completionReason;
  if (reason === "stall" || reason === "budget_exhausted") {
    return { rubric: 0, reason: `agent_det: ${reason} — no final answer` };
  }
  const obj = parseObject(output);
  if (!obj) return { rubric: 0, reason: "agent_det: no valid JSON object" };
  return scorer(obj, ctx ?? {});
}
