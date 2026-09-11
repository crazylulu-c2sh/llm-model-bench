import { describe, expect, it } from "vitest";
import { resultsTableShowsAgentColumn } from "./ResultsTable";

describe("resultsTableShowsAgentColumn", () => {
  it("완료 런의 agent_completion_reason이 있으면 연다", () => {
    expect(
      resultsTableShowsAgentColumn([{ scenario: "chat_hello", agent_completion_reason: "completed" }]),
    ).toBe(true);
  });

  it("시나리오 id만으로도 연다(reason 필드가 아직 없는 라이브 행)", () => {
    expect(resultsTableShowsAgentColumn([{ scenario: "agent_loop_mock_v1" }])).toBe(true);
  });

  it("예약 행에 에이전트가 있으면 첫 완료 전에도 연다", () => {
    expect(
      resultsTableShowsAgentColumn([{ scenario: "chat_hello" }], [{ scenario: "agent_loop_mock_v1" }]),
    ).toBe(true);
  });

  it("텍스트·비전만이면 닫는다", () => {
    expect(
      resultsTableShowsAgentColumn(
        [{ scenario: "chat_hello" }, { scenario: "vision_table_ocr_a" }],
        [{ scenario: "vision_wireframe_html_b" }],
      ),
    ).toBe(false);
  });
});
