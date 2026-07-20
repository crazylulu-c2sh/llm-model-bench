import { describe, expect, it } from "vitest";
import {
  AGENT_LOOP_BUDGET_V1,
  AGENT_LOOP_CHAIN_V1,
  AGENT_LOOP_DOCS_V1,
  AGENT_LOOP_ERROR_V1,
  AGENT_LOOP_GROUNDING_V1,
  AGENT_LOOP_MOCK_V1,
  BUILTIN_AGENT_LOOP_IDS,
} from "./agent-loop-builtin";
import { getScenarioDef, isRegisteredScenario, listScenarioDefs } from "./scenario-registry";
import {
  AGENT_AES_GROUND_TRUTH,
  AGENT_CHAIN_GROUND_TRUTH,
  AGENT_DOCS_GROUND_TRUTH,
  AGENT_EXPECTED_TOOLS,
  AGENT_EXPECTED_TOOL_CALLS,
  AGENT_GROUNDING_GROUND_TRUTH,
} from "./scenario-scoring-constants";

describe("builtin agent_loop scenarios (#79/#101)", () => {
  it("agent_loop_budget_v1 mirrors mock_v1 but tightens per-turn max_tokens to the separating budget (192)", () => {
    expect(AGENT_LOOP_BUDGET_V1.id).toBe("agent_loop_budget_v1");
    // 예산만 다르고 나머지(스크립트·도구·판정)는 동일해야 한다.
    expect(AGENT_LOOP_BUDGET_V1.sampling?.max_tokens).toBe(192);
    expect(AGENT_LOOP_MOCK_V1.sampling?.max_tokens).toBe(640);
    expect(AGENT_LOOP_BUDGET_V1.tools).toBe(AGENT_LOOP_MOCK_V1.tools);
    expect(AGENT_LOOP_BUDGET_V1.agentLoop).toBe(AGENT_LOOP_MOCK_V1.agentLoop);
    expect(AGENT_LOOP_BUDGET_V1.judge).toBe(AGENT_LOOP_MOCK_V1.judge);
    expect(AGENT_LOOP_BUDGET_V1.source).toBe("builtin");
  });

  it("is registered (importing the module registers it) and listed in BUILTIN_AGENT_LOOP_IDS", () => {
    expect(isRegisteredScenario("agent_loop_budget_v1")).toBe(true);
    expect(getScenarioDef("agent_loop_budget_v1")?.agentLoop).toBeDefined();
    expect(BUILTIN_AGENT_LOOP_IDS).toContain("agent_loop_budget_v1");
    expect(BUILTIN_AGENT_LOOP_IDS).toContain("agent_loop_mock_v1");
  });

  // #105: 새 스위트 3종 등록 + 도구/판정/argDispatch 형태.
  it("agent_loop_docs_v1: 멀티문서 다이제스트 — list_documents + read_document(argDispatch)", () => {
    expect(isRegisteredScenario("agent_loop_docs_v1")).toBe(true);
    const loop = AGENT_LOOP_DOCS_V1.agentLoop!;
    expect(loop.maxTurns).toBe(8);
    const read = loop.mockTools.find((m) => m.tool === "read_document")!;
    expect(read.argDispatch?.argKey).toBe("id");
    // #105: 가상 corpus — 공개 canon(AES/DES/RSA)이면 도구 없이 회상만으로 답이 나와 그라운딩을 못 잰다.
    expect(Object.keys(read.argDispatch!.cases)).toEqual(["doc_kestrel", "doc_marlin", "doc_quartz"]);
    expect(AGENT_LOOP_DOCS_V1.sampling?.max_tokens).toBe(512);
  });

  // #105: 빌트인 agent 시나리오는 결정론 채점기가 채점하므로 judge 루브릭을 두지 않는다
  // (두면 아무도 안 읽는 죽은 설정이 된다). 커스텀은 여전히 judge 필수.
  it("빌트인 agent 시나리오에는 judge 루브릭이 없다(결정론 채점 전용)", () => {
    for (const def of listScenarioDefs("builtin").filter((d) => d.agentLoop)) {
      expect(def.judge, `${def.id} 에 죽은 judge 설정이 남아 있다`).toBeUndefined();
    }
  });

  // #105: grounding 은 catalog_search title 이 답을 누설하면 catalog_read 없이도 만점이 난다.
  it("catalog_search title 은 답을 누설하지 않는다", () => {
    const search = AGENT_LOOP_GROUNDING_V1.agentLoop!.mockTools.find((m) => m.tool === "catalog_search")!;
    const titles = (JSON.parse(search.responses[0]!) as Array<{ title: string }>).map((r) => r.title.toLowerCase());
    // 레코드 본문의 고유 사실 토큰이 title 에 섞여 있으면 안 된다.
    for (const leak of ["halcyon", "aster", "vela", "marlin", "kestrel"]) {
      expect(titles.join(" "), `title 이 "${leak}" 을 누설한다`).not.toContain(leak);
    }
  });

  // #108 후속: 에러는 **불가피한 첫 도구**(read_document)에 있어야 한다. wiki_read 에 두면
  // 워크플로를 단축한 모델은 에러를 만나지도 못해 시나리오가 아무것도 측정하지 못한다.
  it("agent_loop_error_v1: read_document 시퀀스 mock 1차 에러(retryable)→2차 정상 본문", () => {
    expect(isRegisteredScenario("agent_loop_error_v1")).toBe(true);
    const readDoc = AGENT_LOOP_ERROR_V1.agentLoop!.mockTools.find((m) => m.tool === "read_document")!;
    expect(readDoc.argDispatch).toBeUndefined(); // 시퀀스 mock
    expect(readDoc.responses[0]).toContain("retryable");
    expect(readDoc.responses[1]).toContain("Advanced Encryption Standard");
    expect(AGENT_LOOP_ERROR_V1.system).toContain("retryable");
    // wiki_read 는 이제 에러가 아니라 정상 본문만 준다(건너뛰어도 무방한 도구).
    const wikiRead = AGENT_LOOP_ERROR_V1.agentLoop!.mockTools.find((m) => m.tool === "wiki_read")!;
    expect(wikiRead.responses[0]).not.toContain("retryable");
  });

  it("agent_loop_grounding_v1: catalog_read argDispatch 는 불투명 UUID형 id를 정확 일치로만 매칭", () => {
    expect(isRegisteredScenario("agent_loop_grounding_v1")).toBe(true);
    const read = AGENT_LOOP_GROUNDING_V1.agentLoop!.mockTools.find((m) => m.tool === "catalog_read")!;
    expect(read.argDispatch?.argKey).toBe("id");
    expect(Object.keys(read.argDispatch!.cases)).toEqual(["rec_9f3a1c77-4b2e", "rec_0d84e2ab-77f1"]);
    expect(read.argDispatch?.fallback).toContain("copy the id exactly");
  });

  // #105 가드: 각 문서의 1차 마커가 **다른 문서 본문에는 없어야** 교차오염 판정이 성립한다.
  // (초판의 `AES`·`1977` 처럼 여러 문서에 걸치는 토큰이 다시 들어오는 것을 막는다.)
  it("docs 배타 마커는 실제로 배타적이다", () => {
    const cases = AGENT_LOOP_DOCS_V1.agentLoop!.mockTools.find((m) => m.tool === "read_document")!.argDispatch!.cases;
    const markers: Record<string, string[]> = {
      doc_kestrel: ["halcyon"],
      doc_marlin: ["vela"],
      doc_quartz: ["shortest-vector", "duval"],
    };
    for (const [ownId, own] of Object.entries(markers)) {
      for (const m of own) {
        expect(cases[ownId]!.toLowerCase(), `${ownId} 에 자기 마커 ${m} 없음`).toContain(m);
        for (const otherId of Object.keys(markers)) {
          if (otherId === ownId) continue;
          expect(cases[otherId]!.toLowerCase(), `${otherId} 가 ${ownId} 마커 ${m} 를 오염`).not.toContain(m);
        }
      }
    }
  });

  // #105: 드리프트 가드 — BUILTIN_AGENT_LOOP_IDS(상수, task=agent 필터가 소비)가
  // 실제 레지스트리의 agent_loop 시나리오(set=agent 가 소비)와 정확히 일치해야 한다.
  it("BUILTIN_AGENT_LOOP_IDS ≡ 레지스트리의 builtin agent_loop 시나리오(드리프트 없음)", () => {
    const registered = listScenarioDefs("builtin")
      .filter((d) => d.agentLoop)
      .map((d) => d.id);
    expect(new Set(BUILTIN_AGENT_LOOP_IDS)).toEqual(new Set(registered));
    expect(BUILTIN_AGENT_LOOP_IDS.length).toBe(6);
  });
});

// #108 후속 drift 가드: 채점 상수가 실제 mock/도구와 어긋나면 채점기가 조용히 깨진다.
describe("agent 채점 상수 drift (#108 후속)", () => {
  it("AGENT_EXPECTED_TOOLS 의 도구는 해당 시나리오의 mockTools 에 실존한다", () => {
    for (const def of listScenarioDefs("builtin").filter((d) => d.agentLoop)) {
      const expected = AGENT_EXPECTED_TOOLS[def.id];
      expect(expected, `${def.id} 에 expected tools 정의 없음`).toBeDefined();
      const mocked = new Set(def.agentLoop!.mockTools.map((m) => m.tool));
      for (const t of expected!) {
        expect(mocked.has(t), `${def.id}: 지시 도구 ${t} 가 mockTools 에 없음`).toBe(true);
      }
    }
  });

  it("AES sourceTokens 는 실제 mock 응답에서 유래한다(id·제목 둘 다)", () => {
    const loop = AGENT_LOOP_MOCK_V1.agentLoop!;
    const corpus = loop.mockTools.flatMap((m) => m.responses).join(" ").toLowerCase();
    for (const t of AGENT_AES_GROUND_TRUTH.sourceTokens) {
      expect(corpus, `sourceToken "${t}" 가 mock corpus 에 없음`).toContain(t);
    }
  });

  it("errorLeakMarker 는 error_v1 의 실제 에러 페이로드와 일치한다", () => {
    const readDoc = AGENT_LOOP_ERROR_V1.agentLoop!.mockTools.find((m) => m.tool === "read_document")!;
    expect(readDoc.responses[0]!.toLowerCase()).toContain(AGENT_AES_GROUND_TRUTH.errorLeakMarker);
  });
});

// #109 후속: 3홉 체이닝 — 각 홉이 다음 홉의 입력을 만들고, 최종 답이 셋을 모두 요구한다.
describe("agent_loop_chain_v1 (#109 후속)", () => {
  const loop = () => AGENT_LOOP_CHAIN_V1.agentLoop!;

  it("search 는 ref 만 준다 — record_id/fact 를 흘리면 체인을 건너뛸 수 있다", () => {
    const search = loop().mockTools.find((m) => m.tool === "search")!;
    const body = search.responses[0]!;
    expect(body).toContain(AGENT_CHAIN_GROUND_TRUTH.ref);
    expect(body).not.toContain(AGENT_CHAIN_GROUND_TRUTH.recordId);
    for (const m of AGENT_CHAIN_GROUND_TRUTH.factMarkers) {
      expect(body.toLowerCase()).not.toContain(m);
    }
  });

  it("resolve·fetch 는 이전 홉 산출물을 정확히 넘겨야만 매칭된다(argDispatch)", () => {
    const resolve = loop().mockTools.find((m) => m.tool === "resolve")!;
    const fetchTool = loop().mockTools.find((m) => m.tool === "fetch")!;
    expect(resolve.argDispatch?.argKey).toBe("ref");
    expect(Object.keys(resolve.argDispatch!.cases)).toEqual([AGENT_CHAIN_GROUND_TRUTH.ref]);
    expect(fetchTool.argDispatch?.argKey).toBe("record_id");
    expect(Object.keys(fetchTool.argDispatch!.cases)).toEqual([AGENT_CHAIN_GROUND_TRUTH.recordId]);
  });

  it("fact 마커는 fetch 응답에 실존한다", () => {
    const fetchTool = loop().mockTools.find((m) => m.tool === "fetch")!;
    const body = fetchTool.argDispatch!.cases[AGENT_CHAIN_GROUND_TRUTH.recordId]!.toLowerCase();
    for (const m of AGENT_CHAIN_GROUND_TRUTH.factMarkers) expect(body).toContain(m);
  });

  // 배타성: chain 마커가 docs/grounding corpus 와 겹치면 교차오염 판정이 서로 간섭한다.
  it("chain 마커는 docs/grounding 마커와 겹치지 않는다", () => {
    const others = [
      ...Object.values(AGENT_DOCS_GROUND_TRUTH).flatMap((v) => [...v.primary]),
      ...Object.values(AGENT_GROUNDING_GROUND_TRUTH).flatMap((v) => [...v.primary]),
    ];
    for (const m of AGENT_CHAIN_GROUND_TRUTH.factMarkers) {
      expect(others, `chain 마커 ${m} 가 다른 시나리오 마커와 충돌`).not.toContain(m);
    }
  });
});

// #109 후속: 남용 탐지 분모도 전 시나리오에 있어야 한다.
describe("AGENT_EXPECTED_TOOL_CALLS drift (#109 후속)", () => {
  it("모든 빌트인 agent 시나리오에 기대 호출 수가 정의돼 있고 양수다", () => {
    for (const def of listScenarioDefs("builtin").filter((d) => d.agentLoop)) {
      const n = AGENT_EXPECTED_TOOL_CALLS[def.id];
      expect(n, `${def.id} 에 기대 호출 수 없음`).toBeDefined();
      expect(n!).toBeGreaterThan(0);
      // 지시 도구 수보다 적으면 초과분이 항상 양수로 나와 오탐이 된다.
      expect(n!).toBeGreaterThanOrEqual(AGENT_EXPECTED_TOOLS[def.id]!.length);
    }
  });
});
