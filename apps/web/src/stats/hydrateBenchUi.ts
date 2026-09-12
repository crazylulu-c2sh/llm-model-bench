import { comparisonId } from "@llm-bench/shared";
import { decodeTokensPerSecondFromRun, outputTokensFromRun, prefillTokensPerSecondFromRun, roundTpsDisplay } from "@llm-bench/shared";
import type { BenchRunDetailResponse, BenchScenarioRun } from "../api-types";
import type { ResultRow } from "../components/ResultsTable";
import {
  rowsToChartData,
  scenarioRowKey,
  sortChartRowsForBarOrder,
  type ChartRow,
} from "../components/chart-types";

export type MetricsAgg = {
  source_run_id?: string;
  scenario_id: string;
  api_route: "chat_completions" | "messages";
  /** 마지막 측정 런과 동일한 system 프롬프트 */
  system_prompt?: string;
  /** 마지막 측정 런과 동일한 user 프롬프트(라이브 aggregate 또는 DB prompt_preview) */
  user_prompt?: string;
  runs: BenchScenarioRun[];
};

/** 저장된 런 상세 여러 건을 벤치 라이브와 동일한 rows / aggregate / 프롬프트 맵으로 병합 */
export function mergeBenchDetailsToState(details: BenchRunDetailResponse[], scopeComparisons = true): {
  rows: ResultRow[];
  detailAggregate: Record<string, MetricsAgg>;
  promptByRowKey: Record<string, string>;
  systemPromptByRowKey: Record<string, string>;
} {
  const detailAggregate: Record<string, MetricsAgg> = {};
  const promptByRowKey: Record<string, string> = {};
  const systemPromptByRowKey: Record<string, string> = {};
  const rows: ResultRow[] = [];

  for (const detail of details) {
    const modelId = String(detail.meta.model_id);
    const identity = scopeComparisons ? comparisonId(detail.meta) : modelId;
    const publisher =
      typeof detail.meta.publisher === "string" ? detail.meta.publisher : undefined;
    const thinkingIntent =
      detail.meta.profile_thinking_intent === "on" || detail.meta.profile_thinking_intent === "off"
        ? detail.meta.profile_thinking_intent
        : undefined;
    const reasoningEffort =
      typeof detail.meta.reasoning_effort === "string" ? detail.meta.reasoning_effort : undefined;
    for (const sc of detail.scenarios) {
      const runs = sc.runs ?? [];
      const rowKey = scenarioRowKey(sc.id, sc.api_route, identity);
      detailAggregate[rowKey] = {
        source_run_id: sc.source_run_id ?? detail.meta.run_id,
        scenario_id: sc.id,
        api_route: sc.api_route,
        ...(sc.prompt_system_preview != null && sc.prompt_system_preview !== ""
          ? { system_prompt: sc.prompt_system_preview }
          : {}),
        ...(sc.prompt_preview != null && sc.prompt_preview !== ""
          ? { user_prompt: sc.prompt_preview }
          : {}),
        runs,
      };
      if (sc.prompt_system_preview != null && sc.prompt_system_preview !== "") {
        systemPromptByRowKey[rowKey] = sc.prompt_system_preview;
      }
      if (sc.prompt_preview != null && sc.prompt_preview !== "") {
        promptByRowKey[rowKey] = sc.prompt_preview;
      }
      const last = runs[runs.length - 1];
      if (!last) continue;
      const tpsSource =
        last.usage_output_tokens != null && last.usage_output_tokens > 0 ? "usage" : "approx";
      const outputTokens = outputTokensFromRun(last.output_text, last.usage_output_tokens);
      const tps = roundTpsDisplay(
        decodeTokensPerSecondFromRun({
          totalMs: last.total_ms,
          ttftMs: last.ttft_ms,
          outputText: last.output_text,
          usageTokens: last.usage_output_tokens,
        }),
      );
      const prefill_tps = roundTpsDisplay(
        prefillTokensPerSecondFromRun(last.ttft_ms, last.usage_prompt_tokens),
      );
      rows.push({
        rowKey,
        model_id: modelId,
        ...(scopeComparisons ? { comparison_id: identity } : {}),
        publisher,
        scenario: sc.id,
        api: sc.api_route,
        ttft_ms: last.ttft_ms ?? null,
        output_tokens: outputTokens,
        tps,
        prefill_tps,
        tps_source: tpsSource,
        reasoning_hidden: last.reasoning_hidden,
        tool_call_args_corrupted: last.tool_call_args_corrupted,
        reasoning_leaked_into_content: last.reasoning_leaked_into_content,
        channel_tag_leak_detected: last.channel_tag_leak_detected,
        reasoning_control_ignored: last.reasoning_control_ignored,
        agent_completion_reason: last.agent_completion_reason,
        turns_to_completion: last.turns_to_completion,
        empty_turn_count: last.empty_turn_count,
        thinking_exhausted_budget: last.thinking_exhausted_budget,
        thinking_intent: thinkingIntent,
        reasoning_effort: reasoningEffort,
        pass: last.quality?.pass,
        score: last.quality?.score,
        reason: last.quality?.reason,
      });
    }
  }

  return { rows, detailAggregate, promptByRowKey, systemPromptByRowKey };
}

export function buildChartRowsFromBenchState(
  rows: ResultRow[],
  detailAggregate: Record<string, MetricsAgg>,
  benchScenarioOrder: string[] = [],
): ChartRow[] {
  return sortChartRowsForBarOrder(
    rowsToChartData(
      rows.map((r) => {
        const last = detailAggregate[r.rowKey]?.runs?.at(-1);
        return {
          scenario: r.scenario,
          api: r.api,
          ttft_ms: r.ttft_ms,
          pass: r.pass,
          model_id: r.model_id,
          comparison_id: r.comparison_id,
          rowKey: r.rowKey,
          total_ms: last?.total_ms,
          output_text: last?.output_text,
          usage_output_tokens: last?.usage_output_tokens,
          usage_prompt_tokens: last?.usage_prompt_tokens,
          reasoning_hidden: last?.reasoning_hidden,
        };
      }),
    ),
    benchScenarioOrder,
  );
}
