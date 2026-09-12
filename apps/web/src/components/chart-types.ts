import { compareScenarioBenchOrder, compareStringsPinned, decodeTokensPerSecondFromRun, prefillTokensPerSecondFromRun, tokensPerSecondFromRun } from "@llm-bench/shared";
import { truncateChartLabel } from "../lib/chart-theme";

/** 실제 실행 순서(`benchScenarioOrder`) 미전달 시 기본값 — 매 렌더 새 배열 생성으로 인한 참조 불안정 방지용 안정 상수 */
export const EMPTY_SCENARIO_ORDER: string[] = [];

// TPS 산식은 @llm-bench/shared `tps.ts` 단일 소스에서 재-export(복제본 제거, 산식 drift 방지).
// App.tsx·hydrateBenchUi.ts 등 chart-types 경유 import는 자동으로 shared 산식을 쓴다.
export { tokensPerSecondFromRun };

export type ChartRow = {
  id: string;
  labelShort: string;
  /** Y축(가로 차트) 전체 라벨 */
  fullLabel: string;
  scenario: string;
  api: string;
  ttft: number;
  /** 디코드 TPS; 0이면 막대 미표시에 가깝게 처리 */
  tps: number;
  /** 프리필 TPS; 0이면 막대 미표시 */
  prefillTps: number;
  /** TPS 산정에 provider 실토큰을 썼는지 — 툴팁 표기용 */
  tpsSource?: "usage" | "approx";
  /** messages 라우트에서 추론이 숨겨진 채 측정됨 → TTFT 비교 주의 */
  reasoningHidden?: boolean;
  pass?: boolean;
  modelId?: string;
  comparisonId?: string;
  modelLabel?: string;
  /** 막대 차트에서 시나리오·API 그룹 사이 빈 행(멀티 모델 시에만 삽입) */
  categorySpacer?: true;
};

export type CompareSeries = {
  comparisonId?: string;
  modelLabel?: string;
  modelId: string;
  label: string;
  rows: ChartRow[];
};

/** 라이브 세션 `ChartRow`를 모델별 시리즈로 묶어 비교 레이더·피벗에 재사용합니다. */
export function sessionChartRowsToCompareSeries(
  rows: ChartRow[],
  unknownLabel: string,
): CompareSeries[] {
  const byModel = new Map<string, ChartRow[]>();
  for (const r of rows) {
    if (r.categorySpacer) continue;
    const mid = (r.comparisonId ?? r.modelId ?? "").trim() || "_default";
    const list = byModel.get(mid) ?? [];
    list.push(r);
    byModel.set(mid, list);
  }
  return [...byModel.entries()].map(([key, rrows]) => ({
    modelId: rrows[0]?.modelId ?? "",
    comparisonId: rrows[0]?.comparisonId,
    label: key === "_default" ? unknownLabel : (rrows[0]?.modelLabel ?? rrows[0]?.modelId ?? key),
    rows: rrows,
  }));
}

export function apiShort(api: string): string {
  if (api === "chat_completions") return "chat";
  if (api === "messages") return "msg";
  return api;
}

/** 피벗·레이더 축 정렬: chat_completions → messages → 기타(사전순) */
export function apiRouteRank(api: string): number {
  if (api === "chat_completions") return 0;
  if (api === "messages") return 1;
  return 2;
}

/**
 * 시나리오 1차 정렬 기준: 실제 벤치 실행 순서(`realOrder`, 예: `BenchRunMeta.scenario_ids`) 우선,
 * 없으면 정적 카탈로그 순서로 폴백 — `ResultsTable`의 시나리오 정렬과 동일 기준이라
 * 테이블·레이더·막대 차트의 시나리오 순서가 일치한다.
 */
export function compareScenarioExecutionOrder(
  a: string,
  b: string,
  realOrder: string[] = EMPTY_SCENARIO_ORDER,
): number {
  return compareScenarioBenchOrder(a, b, realOrder);
}

/** 비교 시리즈마다 (시나리오·API) 키 집합이 동일한지 — 다르면 레이더에서 모델별로 축이 비는 현상이 난다. */
export function compareSeriesHaveIdenticalScenarioApiKeys(series: CompareSeries[]): boolean {
  if (series.length < 2) return true;
  const keySet = (rows: ChartRow[]) => new Set(rows.map((r) => `${r.scenario}\t${r.api}`));
  const base = keySet(series[0]!.rows);
  for (let i = 1; i < series.length; i++) {
    const cur = keySet(series[i]!.rows);
    if (base.size !== cur.size) return false;
    for (const k of base) {
      if (!cur.has(k)) return false;
    }
    for (const k of cur) {
      if (!base.has(k)) return false;
    }
  }
  return true;
}

/** 서버 scenario_end와 동일 계열: ceil(chars/4) */
export function approxOutputTokens(outputText: string): number {
  return Math.max(0, Math.ceil((outputText ?? "").length / 4));
}

export function scenarioRowKey(scenario: string, api: string, modelId?: string): string {
  const m = modelId ?? "";
  return `${m}|${scenario}|${api}`;
}

/** 라이브 멀티모델 막대 Y축: scenario → API(chat/msg 순) → model → id(안정) */
export function sortChartRowsForBarOrder(
  rows: ChartRow[],
  realOrder: string[] = EMPTY_SCENARIO_ORDER,
): ChartRow[] {
  return [...rows].sort((a, b) => {
    const s = compareScenarioExecutionOrder(a.scenario, b.scenario, realOrder);
    if (s !== 0) return s;
    const d = apiRouteRank(a.api) - apiRouteRank(b.api);
    if (d !== 0) return d;
    if (a.api !== b.api) return compareStringsPinned(a.api, b.api);
    const ma = a.modelId ?? "";
    const mb = b.modelId ?? "";
    if (ma !== mb) return compareStringsPinned(ma, mb);
    return compareStringsPinned(a.id, b.id);
  });
}

export function rowsToChartData(
  rows: {
    scenario: string;
    api: string;
    ttft_ms: number | null;
    pass?: boolean;
    model_id?: string;
    comparison_id?: string;
    rowKey?: string;
    total_ms?: number | null;
    output_text?: string | null;
    usage_output_tokens?: number | null;
    usage_prompt_tokens?: number | null;
    reasoning_hidden?: boolean;
  }[],
): ChartRow[] {
  return rows.map((r, i) => {
    const modelSuffix = r.model_id ? ` · ${r.model_id}` : "";
    const fullLabel = `${r.scenario} (${apiShort(r.api)})${modelSuffix}`;
    const tps =
      decodeTokensPerSecondFromRun({
        totalMs: r.total_ms,
        ttftMs: r.ttft_ms,
        outputText: r.output_text,
        usageTokens: r.usage_output_tokens,
      }) ?? 0;
    const prefillTps = prefillTokensPerSecondFromRun(r.ttft_ms, r.usage_prompt_tokens) ?? 0;
    return {
      id: r.rowKey ?? (scenarioRowKey(r.scenario, r.api, r.comparison_id ?? r.model_id) + `|${i}`),
      labelShort: truncateChartLabel(fullLabel),
      fullLabel,
      scenario: r.scenario,
      api: r.api,
      ttft: r.ttft_ms ?? 0,
      tps,
      prefillTps,
      tpsSource: r.usage_output_tokens != null && r.usage_output_tokens > 0 ? "usage" : "approx",
      reasoningHidden: r.reasoning_hidden,
      pass: r.pass,
      modelId: r.model_id?.trim() || undefined,
      comparisonId: r.comparison_id,
    };
  });
}

export function avg(nums: number[]): number | undefined {
  const v = nums.filter((n) => Number.isFinite(n) && n > 0);
  if (!v.length) return undefined;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export type PivotCompareRow = {
  label: string;
  scenario: string;
  api: string;
  byModel: Record<string, { ttft: number; tps: number; prefillTps: number; pass?: boolean }>;
  /** `compareSeries` 배열 인덱스와 동일 순서 — 모델 id 문자열 불일치 시에도 레이더·막대가 안정적으로 조회됨 */
  bySeriesIndex: Array<{ ttft: number; tps: number; prefillTps: number; pass?: boolean } | undefined>;
};

function rowMetrics(row: ChartRow): { ttft: number; tps: number; prefillTps: number; pass?: boolean } {
  return {
    ttft: Number(row.ttft) || 0,
    tps: Number(row.tps) || 0,
    prefillTps: Number(row.prefillTps) || 0,
    pass: row.pass,
  };
}

/** 비교 모드: 동일 시나리오·API 키로 피벗 */
export function pivotCompareSeries(
  series: CompareSeries[],
  realOrder: string[] = EMPTY_SCENARIO_ORDER,
): PivotCompareRow[] {
  const keyOrder: string[] = [];
  const keyMeta = new Map<string, { scenario: string; api: string; label: string }>();
  for (const s of series) {
    for (const r of s.rows) {
      const k = `${r.scenario}\t${r.api}`;
      if (!keyMeta.has(k)) {
        keyMeta.set(k, {
          scenario: r.scenario,
          api: r.api,
          label: `${r.scenario} (${apiShort(r.api)})`,
        });
        keyOrder.push(k);
      }
    }
  }
  keyOrder.sort((ka, kb) => {
    const a = keyMeta.get(ka)!;
    const b = keyMeta.get(kb)!;
    const s = compareScenarioExecutionOrder(a.scenario, b.scenario, realOrder);
    if (s !== 0) return s;
    const d = apiRouteRank(a.api) - apiRouteRank(b.api);
    if (d !== 0) return d;
    return compareStringsPinned(a.api, b.api);
  });
  return keyOrder.map((k) => {
    const meta = keyMeta.get(k)!;
    const byModel: Record<string, { ttft: number; tps: number; prefillTps: number; pass?: boolean }> = {};
    const bySeriesIndex: PivotCompareRow["bySeriesIndex"] = series.map((s) => {
      const row = s.rows.find((r) => r.scenario === meta.scenario && r.api === meta.api);
      if (!row) return undefined;
      const m = rowMetrics(row);
      byModel[s.comparisonId ?? s.modelId] = m;
      return m;
    });
    return { label: meta.label, scenario: meta.scenario, api: meta.api, byModel, bySeriesIndex };
  });
}

/** 비교 막대: 시나리오+API+모델 단위 행 — `sortChartRowsForBarOrder`와 동일한 정렬 키 */
export type FlatBarDatum = {
  barLabel: string;
  /** Y축(가로 차트) 말줄임 라벨 — `barLabel`은 툴팁 전용, 축 틱은 이걸 쓴다. */
  barLabelShort: string;
  scenario: string;
  api: string;
  modelId?: string;
  comparisonId?: string;
  modelLabel?: string;
  /** 비교 시리즈 인덱스 — TPS 막대 색 구분 등 */
  seriesIndex: number;
  ttft: number;
  tps: number;
  prefillTps: number;
  pass?: boolean;
  /** 시나리오·API 그룹 사이 빈 Y축 카테고리(비교 멀티 모델 시 삽입) */
  categorySpacer?: true;
};

export function comparePivotToFlatBarData(
  pivoted: PivotCompareRow[],
  compareSeries: CompareSeries[],
  fallbackLabel: string,
  realOrder: string[] = EMPTY_SCENARIO_ORDER,
): FlatBarDatum[] {
  const out: FlatBarDatum[] = [];
  for (const p of pivoted) {
    compareSeries.forEach((s, si) => {
      const v = p.bySeriesIndex[si];
      const modelLabel = s.label || s.modelId || fallbackLabel;
      const barLabel = `${p.scenario} (${apiShort(p.api)}) · ${modelLabel}`;
      out.push({
        barLabel,
        barLabelShort: truncateChartLabel(barLabel),
        scenario: p.scenario,
        api: p.api,
        modelId: s.modelId || undefined,
        comparisonId: s.comparisonId,
        seriesIndex: si,
        ttft: v?.ttft ?? 0,
        tps: v?.tps ?? 0,
        prefillTps: v?.prefillTps ?? 0,
        pass: v?.pass,
      });
    });
  }
  out.sort((a, b) => {
    const s = compareScenarioExecutionOrder(a.scenario, b.scenario, realOrder);
    if (s !== 0) return s;
    const d = apiRouteRank(a.api) - apiRouteRank(b.api);
    if (d !== 0) return d;
    if (a.api !== b.api) return compareStringsPinned(a.api, b.api);
    const ma = a.modelId ?? "";
    const mb = b.modelId ?? "";
    if (ma !== mb) return compareStringsPinned(ma, mb);
    return compareStringsPinned(a.barLabel, b.barLabel);
  });
  return out;
}
