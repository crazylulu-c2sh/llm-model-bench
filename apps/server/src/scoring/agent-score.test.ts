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

  it("예산 변종은 본체와 같은 채점기를 쓴다", () => {
    const a = scoreAgentScenario("agent_loop_mock_v1", json(AES_CARD), ok({ toolArgAttempts: null }));
    const b = scoreAgentScenario("agent_loop_budget_v1", json(AES_CARD), ok({ toolArgAttempts: null }));
    expect(b).toEqual(a);
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

describe("agent_loop_mock_v1 / budget_v1 (AES 카드)", () => {
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
