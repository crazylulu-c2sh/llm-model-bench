import {
  AGENT_AES_GROUND_TRUTH,
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

/** 예산 변종은 본체와 스크립트가 같으므로 같은 채점기를 쓴다. */
function baseScenarioId(id: string): string {
  if (id === "agent_loop_budget_v1") return "agent_loop_mock_v1";
  if (id === "agent_loop_docs_budget_v1") return "agent_loop_docs_v1";
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
  const sourcesOk = sources.some((s) => lc(s).includes(AGENT_AES_GROUND_TRUTH.sourceToken));
  if (hits >= 2 && sourcesOk) {
    return { rubric: 3, reason: `agent_det: markers=${hits}/3 sources=ok` };
  }
  if (hits >= 2) return { rubric: 2, reason: `agent_det: markers=${hits}/3 sources=weak` };
  return { rubric: 1, reason: `agent_det: markers=${hits}/3 (thin summary)` };
}

/** `{title, summary, sources[], retried}` 에러 복구 카드 — error_v1. */
function scoreErrorCard(o: Obj): AgentRubric {
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
  // `supersedes DES` 는 wiki_read **성공 본문에만** 있다 → 재시도가 실제로 성공했다는 방증.
  // 다만 프롬프트가 "위키 사실을 요약에 넣어라"라고 요구하진 않으므로 **점수 게이트로 쓰지 않고**
  // 사유 문자열에만 남긴다(자기신고 여부를 운영자가 구분할 수 있게).
  const corroborated = lc(JSON.stringify(o)).includes(AGENT_AES_GROUND_TRUTH.wikiOnlyMarker);
  const note = corroborated ? "corroborated" : "self-reported";
  if (hits < 2) return { rubric: 1, reason: `agent_det: markers=${hits}/3 (thin summary)` };
  if (o.retried === true) return { rubric: 3, reason: `agent_det: retried=true (${note})` };
  return { rubric: 2, reason: "agent_det: retried=false/missing — recovery not claimed" };
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

const SCORERS: Record<string, (o: Obj, ctx: AgentScoreContext) => AgentRubric> = {
  agent_loop_mock_v1: (o) => scoreAesCard(o),
  agent_loop_error_v1: (o) => scoreErrorCard(o),
  agent_loop_docs_v1: scoreDocsDigest,
  agent_loop_grounding_v1: scoreGrounding,
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
