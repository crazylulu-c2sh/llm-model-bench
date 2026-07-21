import { BUILTIN_AGENT_LOOP_IDS } from "@llm-bench/shared";
import { describe, expect, it } from "vitest";
import { hasAgentScorer, scoreAgentScenario, type AgentScoreContext } from "./agent-score.js";

const json = (o: unknown) => JSON.stringify(o);

/** 완주 + 도구를 정직하게 쓴 기본 컨텍스트. */
const ok = (over: Partial<AgentScoreContext> = {}): AgentScoreContext => ({
  completionReason: "completed",
  toolArgAttempts: 3,
  toolArgHits: 3,
  ...over,
});

const AES_CARD = {
  title: "Advanced Encryption Standard",
  summary: "AES (FIPS-197) is a symmetric block cipher with a 128-bit block, based on the Rijndael cipher.",
  sources: ["aes"],
};

const DOCS_OK = {
  title: "Internal specs",
  documents: [
    { id: "doc_kestrel", key_fact: "Stream cipher built on the Halcyon permutation." },
    { id: "doc_marlin", key_fact: "Block cipher deprecated after the Vela distinguisher." },
    { id: "doc_quartz", key_fact: "Lattice key exchange resting on the shortest-vector problem." },
  ],
  summary: "Three internal specifications.",
};

const GROUNDING_OK = {
  answers: [
    { id: "rec_9f3a1c77-4b2e", fact: "The Halcyon permutation was adopted after the Aster review." },
    { id: "rec_0d84e2ab-77f1", fact: "Marlin was deprecated following the Vela distinguisher." },
  ],
};

describe("scoreAgentScenario — 대상 판별", () => {
  it("빌트인 agent 시나리오가 아니면 null(호출부가 폴백)", () => {
    expect(scoreAgentScenario("chat_hello", "{}", ok())).toBeNull();
    expect(scoreAgentScenario("vision_table_ocr_a", "{}", ok())).toBeNull();
  });

  // #113 후속: 초판은 budget_v1 → mock_v1 별칭으로 **같은 채점기**를 썼다. 두 시나리오는
  // max_tokens 만 다르므로 같은 내용 감점이 시나리오 2개 × 라우트 2개 = 4번 계상됐다.
  it("예산 변종은 본체와 **다른** 채점기를 쓴다(중복 계상 제거)", () => {
    const thin = { title: "t", summary: "A cipher standard.", sources: ["nothing relevant"] };
    const mock = scoreAgentScenario("agent_loop_mock_v1", json(thin), ok({ toolArgAttempts: null }));
    const budget = scoreAgentScenario("agent_loop_budget_v1", json(thin), ok({ toolArgAttempts: null }));
    // 내용이 얇아 mock 은 감점, budget 은 "예산 안에 완주" 자체가 통과 기준이라 만점.
    expect(mock?.rubric).toBe(1);
    expect(budget?.rubric).toBe(3);
  });

  // §4 폴백 구멍 봉쇄: judge 를 제거했으므로 채점기가 없는 빌트인은 metrics-only
  // `{pass:true, score:1}` 로 **조용히 자동 만점**이 된다. 전수 검사로 막는다.
  it("가드: BUILTIN_AGENT_LOOP_IDS 전원이 결정론 채점기를 가진다", () => {
    for (const id of BUILTIN_AGENT_LOOP_IDS) {
      expect(hasAgentScorer(id), `${id} 에 결정론 채점기가 없다 — 자동 만점 위험`).toBe(true);
    }
  });
});

describe("공통 규약", () => {
  it("정체·예산소진은 본문과 무관하게 rubric 0", () => {
    for (const reason of ["stall", "budget_exhausted"] as const) {
      const r = scoreAgentScenario("agent_loop_docs_v1", json(DOCS_OK), ok({ completionReason: reason }));
      expect(r?.rubric).toBe(0);
      expect(r?.reason).toContain(reason);
    }
  });

  it("JSON 파싱 실패 → rubric 0", () => {
    const r = scoreAgentScenario("agent_loop_mock_v1", "The user wants a summary. Let me think…", ok());
    expect(r?.rubric).toBe(0);
  });

  it("중첩 JSON 이어도 바깥 객체를 채점한다(추출기 회귀)", () => {
    expect(scoreAgentScenario("agent_loop_grounding_v1", json(GROUNDING_OK), ok({ toolArgHits: 2, toolArgAttempts: 2 }))?.rubric).toBe(3);
  });
});

describe("agent_loop_mock_v1 (AES 카드)", () => {
  const ctx = ok({ toolArgAttempts: null, toolArgHits: null });

  it("마커≥2 + sources 유효 → 3", () => {
    expect(scoreAgentScenario("agent_loop_mock_v1", json(AES_CARD), ctx)?.rubric).toBe(3);
  });

  it("(마) sources 가 문서를 전혀 참조하지 않으면 3점 불가", () => {
    const r = scoreAgentScenario("agent_loop_mock_v1", json({ ...AES_CARD, sources: ["none"] }), ctx);
    expect(r?.rubric).toBe(2);
  });

  // #108 후속: 프롬프트가 sources 형식을 요구한 적이 없으므로 id 든 제목이든 인정한다.
  // 초판은 id(`aes`)만 인정해 제목 인용 모델을 부당 감점했고 26b 순위를 뒤집었다.
  it("(마) 제목으로 인용해도 통과 — id 형식을 강요하지 않는다", () => {
    const byTitle = { ...AES_CARD, sources: ["SOURCE DOCUMENT", "Wiki: Advanced Encryption Standard"] };
    expect(scoreAgentScenario("agent_loop_mock_v1", json(byTitle), ctx)?.rubric).toBe(3);
    const byId = { ...AES_CARD, sources: ["SOURCE DOCUMENT", "wiki:aes"] };
    expect(scoreAgentScenario("agent_loop_mock_v1", json(byId), ctx)?.rubric).toBe(3);
  });

  it("스키마 결손 → 1", () => {
    const r = scoreAgentScenario("agent_loop_mock_v1", json({ title: "t", summary: "s" }), ctx);
    expect(r?.rubric).toBe(1);
  });

  it("에러 페이로드를 요약하면 1", () => {
    const r = scoreAgentScenario(
      "agent_loop_mock_v1",
      json({ ...AES_CARD, summary: "The tool returned page_load_failed so I stopped." }),
      ctx,
    );
    expect(r?.rubric).toBe(1);
  });
});

describe("agent_loop_error_v1 (재시도 실측)", () => {
  // read_document 에 에러가 있으므로 카운터가 재시도 진위를 판정한다.
  const ctx = (reads: number | null, over: Partial<AgentScoreContext> = {}): AgentScoreContext => ({
    completionReason: "completed",
    toolArgAttempts: null,
    toolArgHits: null,
    ...(reads == null ? {} : { toolCallCounts: { read_document: reads, wiki_search: 1 } }),
    ...over,
  });
  const card = { ...AES_CARD, retried: true };

  it("실제 재시도(read_document ×2) + retried=true → 3", () => {
    const r = scoreAgentScenario("agent_loop_error_v1", json(card), ctx(2));
    expect(r?.rubric).toBe(3);
    expect(r?.reason).toContain("verified");
  });

  it("자기신고 허위 — 플래그만 true 이고 실제로는 1회 → 2", () => {
    const r = scoreAgentScenario("agent_loop_error_v1", json(card), ctx(1));
    expect(r?.rubric).toBe(2);
    expect(r?.reason).toContain("is false");
  });

  it("재시도는 했는데 플래그를 안 켬 → 2", () => {
    const r = scoreAgentScenario("agent_loop_error_v1", json({ ...card, retried: false }), ctx(2));
    expect(r?.rubric).toBe(2);
    expect(r?.reason).toContain("flag not set");
  });

  it("에러 후 포기(1회, 플래그 false) → 2", () => {
    expect(scoreAgentScenario("agent_loop_error_v1", json({ ...card, retried: false }), ctx(1))?.rubric).toBe(2);
  });

  it("도구 미호출(read_document 0회) → rubric 1 캡 — 시나리오 미발동", () => {
    const r = scoreAgentScenario("agent_loop_error_v1", json(card), ctx(0));
    expect(r?.rubric).toBe(1);
    expect(r?.reason).toContain("ungrounded");
  });

  it("카운터 부재(레거시 런) → 자기신고 폴백 + unverified 표기", () => {
    const r = scoreAgentScenario("agent_loop_error_v1", json(card), ctx(null));
    expect(r?.rubric).toBe(3);
    expect(r?.reason).toContain("unverified");
  });

  it("retried 필드 자체가 없으면 스키마 결손 → 1", () => {
    expect(scoreAgentScenario("agent_loop_error_v1", json(AES_CARD), ctx(2))?.rubric).toBe(1);
  });

  it("에러 페이로드를 요약하면 1", () => {
    const leak = { ...card, summary: "The tool returned document_load_failed so I stopped." };
    expect(scoreAgentScenario("agent_loop_error_v1", json(leak), ctx(2))?.rubric).toBe(1);
  });
});

describe("agent_loop_docs_v1 (멀티문서 귀속 + 도구 증거)", () => {
  it("3/3 정확 귀속 + reads 3 → 3", () => {
    expect(scoreAgentScenario("agent_loop_docs_v1", json(DOCS_OK), ok())?.rubric).toBe(3);
  });

  it("(가) read_document 를 아예 안 부르면 rubric 1 캡(회상 차단)", () => {
    const r = scoreAgentScenario("agent_loop_docs_v1", json(DOCS_OK), ok({ toolArgAttempts: 0, toolArgHits: 0 }));
    expect(r?.rubric).toBe(1);
    expect(r?.reason).toContain("ungrounded");
  });

  it("(가) 읽은 문서 수가 모자라면 3점 불가", () => {
    const r = scoreAgentScenario("agent_loop_docs_v1", json(DOCS_OK), ok({ toolArgAttempts: 2, toolArgHits: 2 }));
    expect(r?.rubric).toBe(2);
  });

  it("교차오염(사실 뒤바뀜) 탐지 — Marlin 항목에 Halcyon 이 섞이면 감점", () => {
    const swapped = {
      ...DOCS_OK,
      documents: [
        DOCS_OK.documents[0],
        { id: "doc_marlin", key_fact: "Built on the Halcyon permutation." }, // ← kestrel 사실
        DOCS_OK.documents[2],
      ],
    };
    const r = scoreAgentScenario("agent_loop_docs_v1", json(swapped), ok());
    expect(r!.rubric).toBeLessThan(3);
  });

  it("문서 id 집합 불일치 → 1", () => {
    const wrong = { ...DOCS_OK, documents: [{ id: "doc_aes", key_fact: "…" }] };
    expect(scoreAgentScenario("agent_loop_docs_v1", json(wrong), ok())?.rubric).toBe(1);
  });
});

describe("agent_loop_grounding_v1 (불투명 id + 도구 증거)", () => {
  const ctx = ok({ toolArgAttempts: 2, toolArgHits: 2 });

  it("id 2/2 + fact 2/2 + reads 2 → 3", () => {
    expect(scoreAgentScenario("agent_loop_grounding_v1", json(GROUNDING_OK), ctx)?.rubric).toBe(3);
  });

  it("id 절단 → 감점(완전일치만 인정)", () => {
    const truncated = {
      answers: [
        { id: "rec_9f3a1c77", fact: "Halcyon adopted after the Aster review." },
        GROUNDING_OK.answers[1],
      ],
    };
    const r = scoreAgentScenario("agent_loop_grounding_v1", json(truncated), ctx);
    expect(r!.rubric).toBeLessThan(3);
  });

  it("id 를 전부 지어내면 0", () => {
    const hallucinated = { answers: [{ id: "rec_zzz", fact: "…" }] };
    expect(scoreAgentScenario("agent_loop_grounding_v1", json(hallucinated), ctx)?.rubric).toBe(0);
  });

  it("(가) catalog_read 미호출 → rubric 1 캡", () => {
    const r = scoreAgentScenario("agent_loop_grounding_v1", json(GROUNDING_OK), ok({ toolArgAttempts: 0, toolArgHits: 0 }));
    expect(r?.rubric).toBe(1);
  });

  it("id 는 맞지만 fact 가 corpus 마커와 안 맞으면 3점 불가(회상으로 채운 경우)", () => {
    const vague = {
      answers: [
        { id: "rec_9f3a1c77-4b2e", fact: "A cipher was selected." },
        { id: "rec_0d84e2ab-77f1", fact: "A standard was withdrawn." },
      ],
    };
    const r = scoreAgentScenario("agent_loop_grounding_v1", json(vague), ctx);
    expect(r!.rubric).toBeLessThan(3);
  });
});

describe("숫자 마커 경계 가드", () => {
  it("`256` 안의 `56` 을 오탐하지 않는다", () => {
    // doc_kestrel 은 numeric 보조 마커 192 를 갖지만 판정은 고유명사(halcyon)로 한다 —
    // 여기서는 경계 가드 자체가 살아 있는지만 확인한다(키 사이즈 256 이 있어도 오작동 없음).
    const withKeySizes = {
      ...DOCS_OK,
      documents: [
        { id: "doc_kestrel", key_fact: "Halcyon permutation, key sizes 128 and 256." },
        DOCS_OK.documents[1],
        DOCS_OK.documents[2],
      ],
    };
    expect(scoreAgentScenario("agent_loop_docs_v1", json(withKeySizes), ok())?.rubric).toBe(3);
  });
});

// ─── #113 후속: 예산 변종 전용 채점기 ─────────────────────────────────────────
describe("agent_loop_budget_v1 (완주 여부만)", () => {
  const ctx = ok({ toolArgAttempts: null, toolArgHits: null });

  it("카드 스키마를 갖춰 완주 → 3", () => {
    expect(scoreAgentScenario("agent_loop_budget_v1", json(AES_CARD), ctx)?.rubric).toBe(3);
  });

  it("내용 마커·sources 를 보지 않는다 — mock_v1 이 재는 축을 중복 계상하지 않는다", () => {
    const noMarkers = { title: "t", summary: "It is a cipher.", sources: ["irrelevant"] };
    expect(scoreAgentScenario("agent_loop_budget_v1", json(noMarkers), ctx)?.rubric).toBe(3);
  });

  it("스키마 결손 → 1", () => {
    const r = scoreAgentScenario("agent_loop_budget_v1", json({ title: "t", summary: "s" }), ctx);
    expect(r?.rubric).toBe(1);
  });

  it("예산 소진(정체) → 0 — 이 시나리오가 실제로 재는 것", () => {
    const r = scoreAgentScenario("agent_loop_budget_v1", json(AES_CARD), {
      ...ctx,
      completionReason: "budget_exhausted",
    });
    expect(r?.rubric).toBe(0);
  });
});

// ─── #113 후속: 방해 후보 + 기권 ───────────────────────────────────────────────
describe("agent_loop_chain_v1 (방해 후보 + 기권)", () => {
  const SELECT_OK = {
    ref: "REF-B2",
    record_id: "rec_ok_22b",
    fact: "The Thornbury schedule sets the Larkspur window to 12 cycles.",
  };
  /** superseded 후보를 따라가 그럴듯하게 지어낸 답(= 함정 발동). */
  const HALLUCINATED = {
    ref: "REF-D4",
    record_id: "rec_wr_40d",
    fact: "A retired note set the interval to 21 cycles.",
  };
  const ABSTAIN = { abstained: true };
  const results = (a: unknown, b: unknown) => json({ results: [a, b] });

  const ctx = (fetches: number | null): AgentScoreContext => ({
    completionReason: "completed",
    toolArgAttempts: 2,
    toolArgHits: 2,
    ...(fetches == null ? {} : { toolCallCounts: { search: 2, resolve: 1, fetch: fetches } }),
  });

  it("2/2 (active 선택 + 기권) → 3", () => {
    const r = scoreAgentScenario("agent_loop_chain_v1", results(SELECT_OK, ABSTAIN), ctx(1));
    expect(r?.rubric).toBe(3);
    expect(r?.reason).toContain("select=ok abstain=ok");
  });

  // 이 스위트가 처음으로 잡을 수 있게 된 실패 유형 — 이전 6종은 "답을 못 냄"만 잡았다.
  it("기권해야 할 조회에서 superseded 레코드로 답을 지어냄 → 1/2 + hallucinated", () => {
    const r = scoreAgentScenario("agent_loop_chain_v1", results(SELECT_OK, HALLUCINATED), ctx(2));
    expect(r?.rubric).toBe(2);
    expect(r?.reason).toContain("abstain=hallucinated");
  });

  it("방해 후보를 골라 선택도 틀림 → 0/2", () => {
    const wrongPick = {
      ref: "REF-A1",
      record_id: "rec_wr_10a",
      fact: "An earlier revision set the window to 5 cycles.",
    };
    const r = scoreAgentScenario("agent_loop_chain_v1", results(wrongPick, HALLUCINATED), ctx(2));
    expect(r?.rubric).toBe(1);
    expect(r?.reason).toContain("select=hallucinated abstain=hallucinated");
  });

  it("active 후보가 있는데 기권 → 오답(과소신뢰)", () => {
    const r = scoreAgentScenario("agent_loop_chain_v1", results(ABSTAIN, ABSTAIN), ctx(1));
    expect(r?.rubric).toBe(2);
    expect(r?.reason).toContain("select=abstained");
  });

  it("record_id 는 맞지만 fact 가 레코드 내용을 안 담으면 오답(회상으로 채운 경우)", () => {
    const vague = { ...SELECT_OK, fact: "A schedule sets a window." };
    const r = scoreAgentScenario("agent_loop_chain_v1", results(vague, ABSTAIN), ctx(1));
    expect(r?.rubric).toBe(2);
    expect(r?.reason).toContain("select=wrong");
  });

  it("results[] 결손/개수 불일치 → 1", () => {
    expect(scoreAgentScenario("agent_loop_chain_v1", json(SELECT_OK), ctx(1))?.rubric).toBe(1);
    const one = scoreAgentScenario("agent_loop_chain_v1", json({ results: [SELECT_OK] }), ctx(1));
    expect(one?.rubric).toBe(1);
    expect(one?.reason).toContain("expected 2");
  });

  it("fetch 미호출 → rubric 1 캡(근거 없는 답)", () => {
    const r = scoreAgentScenario("agent_loop_chain_v1", results(SELECT_OK, ABSTAIN), ctx(0));
    expect(r?.rubric).toBe(1);
    expect(r?.reason).toContain("ungrounded");
  });

  it("카운터 부재(레거시 런)에는 캡을 적용하지 않는다", () => {
    expect(scoreAgentScenario("agent_loop_chain_v1", results(SELECT_OK, ABSTAIN), ctx(null))?.rubric).toBe(3);
  });

  it("정체는 본문 무관 0", () => {
    const r = scoreAgentScenario("agent_loop_chain_v1", results(SELECT_OK, ABSTAIN), {
      ...ctx(1),
      completionReason: "stall",
    });
    expect(r?.rubric).toBe(0);
  });

  /**
   * 초판 사다리는 **비단조**였다: `ref` 불일치 = 0, 스키마 미완 = 1 — 정답 필드를 하나 더
   * 채우면 점수가 내려갔다(실측에서 한 모델이 이 경로로 위로 오채점됐다). 신판은 "맞은 항목 수"
   * 사다리라 구조적으로 불가능하지만, 회귀를 여기서 고정한다.
   */
  it("단조성: 답을 더 정확하게 만들수록 점수가 내려가지 않는다", () => {
    const rubricOf = (a: unknown, b: unknown) =>
      scoreAgentScenario("agent_loop_chain_v1", results(a, b), ctx(2))!.rubric;
    // 같은 항목2(기권 성공)를 두고 항목1 을 점점 정확하게 채워 간다.
    const ladder = [
      {},                                              // 빈 항목
      { ref: "REF-B2" },                               // ref 만
      { ref: "REF-B2", record_id: "rec_ok_22b" },      // + record_id
      SELECT_OK,                                       // + fact
    ];
    const scores = ladder.map((item) => rubricOf(item, ABSTAIN));
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i], `단계 ${i} 에서 점수 하락: ${scores.join(" → ")}`).toBeGreaterThanOrEqual(
        scores[i - 1]!,
      );
    }
    // 항목2 도 마찬가지: 지어낸 답 → 기권으로 고치면 올라가야 한다.
    expect(rubricOf(SELECT_OK, ABSTAIN)).toBeGreaterThan(rubricOf(SELECT_OK, HALLUCINATED));
  });
});
