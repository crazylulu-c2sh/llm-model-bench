import type { BenchRunDetailResponse } from "../api-types";
import type { ResultRow } from "../components/ResultsTable";
import {
  rowsToChartData,
  scenarioRowKey,
  sortChartRowsForBarOrder,
  tokensPerSecondFromRun,
  type ChartRow,
} from "../components/chart-types";

export type MetricsAgg = {
  scenario_id: string;
  api_route: "chat_completions" | "messages";
  /** 마지막 측정 런과 동일한 system 프롬프트 */
  system_prompt?: string;
  /** 마지막 측정 런과 동일한 user 프롬프트(라이브 aggregate 또는 DB prompt_preview) */
  user_prompt?: string;
  runs: Array<{
    ttft_ms: number | null;
    total_ms: number;
    output_text: string;
    stream_completed: boolean;
    usage_output_tokens?: number | null;
    reasoning_hidden?: boolean;
    quality?: { pass: boolean; score?: number; reason?: string };
  }>;
};

/** 저장된 런 상세 여러 건을 벤치 라이브와 동일한 rows / aggregate / 프롬프트 맵으로 병합 */
export function mergeBenchDetailsToState(details: BenchRunDetailResponse[]): {
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
    for (const sc of detail.scenarios) {
      const runs = sc.runs ?? [];
      const rowKey = scenarioRowKey(sc.id, sc.api_route, modelId);
      detailAggregate[rowKey] = {
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
      const tpsRaw = tokensPerSecondFromRun(last.total_ms, last.output_text, last.usage_output_tokens);
      const tps = tpsRaw > 0 ? Math.round(tpsRaw * 10) / 10 : null;
      rows.push({
        rowKey,
        model_id: modelId,
        scenario: sc.id,
        api: sc.api_route,
        ttft_ms: last.ttft_ms ?? null,
        tps,
        tps_source: last.usage_output_tokens != null && last.usage_output_tokens > 0 ? "usage" : "approx",
        reasoning_hidden: last.reasoning_hidden,
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
          total_ms: last?.total_ms,
          output_text: last?.output_text,
          usage_output_tokens: last?.usage_output_tokens,
          reasoning_hidden: last?.reasoning_hidden,
        };
      }),
    ),
  );
}
