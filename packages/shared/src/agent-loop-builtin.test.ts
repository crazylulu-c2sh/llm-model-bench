import { describe, expect, it } from "vitest";
import {
  AGENT_LOOP_BUDGET_V1,
  AGENT_LOOP_DOCS_V1,
  AGENT_LOOP_ERROR_V1,
  AGENT_LOOP_GROUNDING_V1,
  AGENT_LOOP_MOCK_V1,
  BUILTIN_AGENT_LOOP_IDS,
} from "./agent-loop-builtin";
import { getScenarioDef, isRegisteredScenario, listScenarioDefs } from "./scenario-registry";

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
    expect(Object.keys(read.argDispatch!.cases)).toEqual(["doc_aes", "doc_des", "doc_rsa"]);
    expect(AGENT_LOOP_DOCS_V1.judge?.scale).toBe("0-3");
    expect(AGENT_LOOP_DOCS_V1.sampling?.max_tokens).toBe(512);
  });

  it("agent_loop_error_v1: wiki_read 시퀀스 mock 1차 에러(retryable)→2차 정상 본문", () => {
    expect(isRegisteredScenario("agent_loop_error_v1")).toBe(true);
    const wikiRead = AGENT_LOOP_ERROR_V1.agentLoop!.mockTools.find((m) => m.tool === "wiki_read")!;
    expect(wikiRead.argDispatch).toBeUndefined(); // 시퀀스 mock
    expect(wikiRead.responses[0]).toContain("retryable");
    expect(wikiRead.responses[1]).toContain("Advanced Encryption Standard");
    expect(AGENT_LOOP_ERROR_V1.system).toContain("retryable");
  });

  it("agent_loop_grounding_v1: catalog_read argDispatch 는 불투명 UUID형 id를 정확 일치로만 매칭", () => {
    expect(isRegisteredScenario("agent_loop_grounding_v1")).toBe(true);
    const read = AGENT_LOOP_GROUNDING_V1.agentLoop!.mockTools.find((m) => m.tool === "catalog_read")!;
    expect(read.argDispatch?.argKey).toBe("id");
    expect(Object.keys(read.argDispatch!.cases)).toEqual(["rec_9f3a1c77-4b2e", "rec_0d84e2ab-77f1"]);
    expect(read.argDispatch?.fallback).toContain("copy the id exactly");
  });

  // #105: 드리프트 가드 — BUILTIN_AGENT_LOOP_IDS(상수, task=agent 필터가 소비)가
  // 실제 레지스트리의 agent_loop 시나리오(set=agent 가 소비)와 정확히 일치해야 한다.
  it("BUILTIN_AGENT_LOOP_IDS ≡ 레지스트리의 builtin agent_loop 시나리오(드리프트 없음)", () => {
    const registered = listScenarioDefs("builtin")
      .filter((d) => d.agentLoop)
      .map((d) => d.id);
    expect(new Set(BUILTIN_AGENT_LOOP_IDS)).toEqual(new Set(registered));
    expect(BUILTIN_AGENT_LOOP_IDS.length).toBe(5);
  });
});
