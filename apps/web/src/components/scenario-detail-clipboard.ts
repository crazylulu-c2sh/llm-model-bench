import {
  formatTtftMs,
  getScenarioBenchMeta,
  isVisionScenario,
  partitionThinkingBlocks,
  scoreToRubric,
} from "@llm-bench/shared";
import type { ScenarioDetailPayload } from "./ScenarioDetailDrawer";

/** 품질 라인 — 드로어 표시와 동일 규칙(비전은 rubric/score, 그 외는 통과/실패). */
function qualityLine(payload: ScenarioDetailPayload): string {
  if (isVisionScenario(payload.scenario) && typeof payload.score === "number") {
    const rubric = scoreToRubric(payload.score);
    const label = payload.pass === true ? "통과" : payload.pass === false ? "미통과" : "—";
    return `rubric ${rubric ?? "?"}/3 · score ${payload.score.toFixed(2)} (${label})`;
  }
  return payload.pass === true ? "통과" : payload.pass === false ? "실패" : "—";
}

function measuredRunSuffix(payload: ScenarioDetailPayload): string {
  return payload.measuredRunIndex != null && payload.measuredRunTotal != null
    ? ` (측정 ${payload.measuredRunIndex}/${payload.measuredRunTotal})`
    : " (마지막 측정 런)";
}

/**
 * 시나리오 상세 모달 전체 내용을 정규화된 텍스트로 조합한다(스크린샷 대체 용도).
 * 모델 출력은 앱의 정규화 단일 소스(`partitionThinkingBlocks`)로 사고 블록을 분리하며,
 * 채점에 쓰이는 최종 응답(사고 제거 + trim)을 "모델 출력" 섹션에 담는다.
 */
export function buildScenarioDetailClipboardText(payload: ScenarioDetailPayload): string {
  const { thinking, response } = partitionThinkingBlocks(payload.outputText ?? "");
  const benchMeta = getScenarioBenchMeta(payload.scenario);

  const lines: string[] = [];
  lines.push(`# 시나리오 상세 — ${payload.title}`, "");

  lines.push(`- 시나리오: ${payload.scenario}`);
  lines.push(`- API: ${payload.api}`);
  if (payload.modelId) lines.push(`- 모델: ${payload.modelId}`);
  lines.push(`- TTFT: ${payload.ttft_ms != null ? `${formatTtftMs(payload.ttft_ms)} ms` : "—"}`);
  lines.push(`- 품질: ${qualityLine(payload)}`);
  if (payload.qualityReason) lines.push(`- 판정 사유: ${payload.qualityReason}`);

  const warnings: string[] = [];
  if (payload.toolCallArgsCorrupted) warnings.push("도구 인자 손상(스트리밍 tool_calls 인자 연결·손상)");
  if (payload.reasoningLeakedIntoContent) warnings.push("추론 누수(사고 블록이 응답 content로 섞임)");
  if (payload.reasoningHidden) warnings.push("추론 숨김 — TTFT는 첫 가시 토큰까지(숨은 추론 포함), chat·사고 OFF와 직접 비교 주의");
  if (warnings.length > 0) {
    lines.push("");
    for (const w of warnings) lines.push(`> ⚠ ${w}`);
  }

  if (benchMeta) {
    lines.push("", "## 시나리오 목적", benchMeta.purposeKo);
    lines.push("", "## 합격 / 불합격 기준", benchMeta.criteriaKo);
  }

  lines.push("", "## System Prompt", payload.systemPrompt.trim() || "—");
  lines.push("", "## User Prompt", payload.userPrompt.trim() || "—");

  if (thinking.trim().length > 0) {
    lines.push("", "## 사고 블록", thinking.trim());
    lines.push("", "## 최종 응답 (정규화)", response || "—");
  } else {
    lines.push("", `## 모델 출력 (정규화)${measuredRunSuffix(payload)}`, response || "—");
  }

  return `${lines.join("\n")}\n`;
}
