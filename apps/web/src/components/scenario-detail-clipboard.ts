import {
  formatTtftMs,
  getScenarioBenchMeta,
  isVisionScenario,
  partitionThinkingBlocks,
  scoreToRubric,
} from "@llm-bench/shared";
import type { Messages } from "../i18n";
import type { ScenarioDetailPayload } from "./ScenarioDetailDrawer";

/** 품질 라인 — 드로어 표시와 동일 규칙(비전은 rubric/score, 그 외는 통과/실패). */
function qualityLine(payload: ScenarioDetailPayload, m: Messages): string {
  const r = m.results;
  if (isVisionScenario(payload.scenario) && typeof payload.score === "number") {
    const rubric = scoreToRubric(payload.score);
    const label = payload.pass === true ? r.pass : payload.pass === false ? r.notPass : "—";
    return r.qualityVisionLine(rubric ?? "?", payload.score.toFixed(2), label);
  }
  return payload.pass === true ? r.pass : payload.pass === false ? r.fail : "—";
}

function measuredRunSuffix(payload: ScenarioDetailPayload, m: Messages): string {
  const r = m.results;
  return payload.measuredRunIndex != null && payload.measuredRunTotal != null
    ? r.measuredSuffix(payload.measuredRunIndex, payload.measuredRunTotal)
    : r.lastMeasuredSuffix;
}

/**
 * 시나리오 상세 모달 전체 내용을 정규화된 텍스트로 조합한다(스크린샷 대체 용도).
 * 모델 출력은 앱의 정규화 단일 소스(`partitionThinkingBlocks`)로 사고 블록을 분리하며,
 * 채점에 쓰이는 최종 응답(사고 제거 + trim)을 "모델 출력" 섹션에 담는다.
 */
export function buildScenarioDetailClipboardText(payload: ScenarioDetailPayload, m: Messages): string {
  const { thinking, response } = partitionThinkingBlocks(payload.outputText ?? "");
  const benchMeta = getScenarioBenchMeta(payload.scenario);
  const c = m.results.clipboard;

  const lines: string[] = [];
  lines.push(c.header(payload.title), "");

  lines.push(c.scenario(payload.scenario));
  lines.push(`- API: ${payload.api}`);
  if (payload.modelId) lines.push(c.model(payload.modelId));
  lines.push(`- TTFT: ${payload.ttft_ms != null ? `${formatTtftMs(payload.ttft_ms)} ms` : "—"}`);
  lines.push(c.quality(qualityLine(payload, m)));
  if (payload.qualityReason) lines.push(c.reason(payload.qualityReason));

  const warnings: string[] = [];
  if (payload.toolCallArgsCorrupted) warnings.push(c.warnToolArgs);
  if (payload.reasoningLeakedIntoContent) warnings.push(c.warnReasoningLeak);
  if (payload.reasoningHidden) warnings.push(c.warnReasoningHidden);
  if (warnings.length > 0) {
    lines.push("");
    for (const w of warnings) lines.push(`> ⚠ ${w}`);
  }

  if (benchMeta) {
    lines.push("", c.purposeHeading, benchMeta.purposeKo);
    lines.push("", c.criteriaHeading, benchMeta.criteriaKo);
  }

  lines.push("", "## System Prompt", payload.systemPrompt.trim() || "—");
  lines.push("", "## User Prompt", payload.userPrompt.trim() || "—");

  if (thinking.trim().length > 0) {
    lines.push("", c.thinkingHeading, thinking.trim());
    lines.push("", c.finalHeading, response || "—");
  } else {
    lines.push("", c.outputHeading(measuredRunSuffix(payload, m)), response || "—");
  }

  return `${lines.join("\n")}\n`;
}
