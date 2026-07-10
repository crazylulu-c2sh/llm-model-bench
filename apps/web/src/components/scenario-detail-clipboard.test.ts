import { describe, expect, it } from "vitest";
import { buildScenarioDetailClipboardText } from "./scenario-detail-clipboard";
import type { ScenarioDetailPayload } from "./ScenarioDetailDrawer";

function payload(over: Partial<ScenarioDetailPayload> = {}): ScenarioDetailPayload {
  return {
    title: "code_sort_js / chat_completions",
    scenario: "code_sort_js",
    api: "chat_completions",
    modelId: "some-model",
    ttft_ms: 1234,
    pass: false,
    qualityReason: "missing sortNums",
    systemPrompt: "You are a code-generation assistant.",
    userPrompt: "Write a JavaScript function sortNums(arr) ...",
    outputText: "We need to output just a JS code block...\n\n```js\nfunction sortNums(arr){}\n```",
    measuredRunIndex: 3,
    measuredRunTotal: 3,
    ...over,
  };
}

describe("buildScenarioDetailClipboardText", () => {
  it("includes header, metadata, purpose/criteria, and both prompts", () => {
    const text = buildScenarioDetailClipboardText(payload());
    expect(text).toContain("# 시나리오 상세 — code_sort_js / chat_completions");
    expect(text).toContain("- 시나리오: code_sort_js");
    expect(text).toContain("- API: chat_completions");
    expect(text).toContain("- 모델: some-model");
    expect(text).toContain("- TTFT: 1234 ms");
    expect(text).toContain("- 품질: 실패");
    expect(text).toContain("- 판정 사유: missing sortNums");
    // 등록 시나리오면 목적/기준을 실제 메타에서 채운다
    expect(text).toContain("## 시나리오 목적");
    expect(text).toContain("펜스 코드 블록");
    expect(text).toContain("## 합격 / 불합격 기준");
    expect(text).toContain("## System Prompt");
    expect(text).toContain("## User Prompt");
  });

  it("normalizes model output: no thinking → single '모델 출력 (정규화)' section (trimmed body)", () => {
    const text = buildScenarioDetailClipboardText(payload());
    expect(text).toContain("## 모델 출력 (정규화) (측정 3/3)");
    expect(text).toContain("function sortNums(arr){}");
    // 사고 블록이 없으면 별도 사고/최종 응답 분리 없음
    expect(text).not.toContain("## 사고 블록");
    expect(text).not.toContain("## 최종 응답");
  });

  it("strips thinking blocks: splits into 사고 블록 + 최종 응답 (정규화)", () => {
    const text = buildScenarioDetailClipboardText(
      payload({ outputText: "<think>secret reasoning</think>\n\nfinal answer" }),
    );
    expect(text).toContain("## 사고 블록");
    expect(text).toContain("secret reasoning");
    expect(text).toContain("## 최종 응답 (정규화)");
    expect(text).toContain("final answer");
    // 최종 응답에는 사고 내용이 새어들지 않아야 한다
    const finalSection = text.slice(text.indexOf("## 최종 응답 (정규화)"));
    expect(finalSection).not.toContain("secret reasoning");
  });

  it("omits model line when modelId is absent and surfaces warnings", () => {
    const text = buildScenarioDetailClipboardText(
      payload({ modelId: undefined, reasoningLeakedIntoContent: true }),
    );
    expect(text).not.toContain("- 모델:");
    expect(text).toContain("⚠");
    expect(text).toContain("추론 누수");
  });
});
