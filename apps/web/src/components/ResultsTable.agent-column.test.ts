import { describe, expect, it } from "vitest";
import { ko } from "../i18n/messages/ko";
import { formatUnrunBannerText, resultsTableShowsAgentColumn } from "./ResultsTable";

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

  it("미실행 행에 에이전트가 있으면 중단 후에도 연다", () => {
    expect(
      resultsTableShowsAgentColumn(
        [{ scenario: "chat_hello" }],
        [],
        [{ scenario: "agent_loop_mock_v1" }],
      ),
    ).toBe(true);
  });

  it("텍스트·비전만이면 닫는다", () => {
    expect(
      resultsTableShowsAgentColumn(
        [{ scenario: "chat_hello" }, { scenario: "vision_table_ocr_a" }],
        [{ scenario: "vision_wireframe_html_b" }],
        [{ scenario: "vision_table_ocr_b" }],
      ),
    ).toBe(false);
  });
});

describe("formatUnrunBannerText", () => {
  const t = ko.results.table;
  const hint = (code: string) => ko.bench.errors[code] ?? null;

  it("skipped가 없으면 배너도 없다", () => {
    expect(formatUnrunBannerText(0, [], t, hint)).toBeNull();
  });

  it("원인 코드가 하나면 힌트를 붙인다", () => {
    expect(formatUnrunBannerText(33, ["total_wait_budget_exceeded"], t, hint)).toBe(
      t.unrunBanner(33, ko.bench.errors.total_wait_budget_exceeded),
    );
  });

  it("코드를 모르면 미실행 배지로 폴백", () => {
    expect(formatUnrunBannerText(2, ["mystery"], t, hint)).toBe(t.unrunBanner(2, t.unrunBadge));
  });

  it("원인이 여럿이면 mixed", () => {
    expect(formatUnrunBannerText(4, ["total_wait_budget_exceeded", "cancelled"], t, hint)).toBe(
      t.unrunBannerMixed(4),
    );
  });
});
