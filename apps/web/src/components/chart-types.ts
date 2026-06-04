import { scenarioExecutionOrderIndex } from "@llm-bench/shared";

export type ChartRow = {
  id: string;
  labelShort: string;
  /** Y축(가로 차트) 전체 라벨 */
  fullLabel: string;
  scenario: string;
  api: string;
  ttft: number;
  tpot: number;
  /** 초당 출력 토큰(usage 있으면 실토큰, 없으면 글자수/4 근사); 0이면 막대 미표시에 가깝게 처리 */
  tps: number;
  /** TPS 산정에 provider 실토큰을 썼는지 — 툴팁 표기용 */
  tpsSource?: "usage" | "approx";
  /** messages 라우트에서 추론이 숨겨진 채 측정됨 → TTFT 비교 주의 */
  reasoningHidden?: boolean;
  pass?: boolean;
  modelId?: string;
  /** 막대 차트에서 시나리오·API 그룹 사이 빈 행(멀티 모델 시에만 삽입) */
  categorySpacer?: true;
};

export type CompareSeries = {
  modelId: string;
  label: string;
  rows: ChartRow[];
};

/** 라이브 세션 `ChartRow`를 모델별 시리즈로 묶어 비교 레이더·피벗에 재사용합니다. */
export function sessionChartRowsToCompareSeries(rows: ChartRow[]): CompareSeries[] {
  const byModel = new Map<string, ChartRow[]>();
  for (const r of rows) {
    if (r.categorySpacer) continue;
    const mid = (r.modelId ?? "").trim() || "_default";
    const list = byModel.get(mid) ?? [];
    list.push(r);
    byModel.set(mid, list);
  }
  return [...byModel.entries()].map(([key, rrows]) => ({
    modelId: key === "_default" ? "" : key,
    label: key === "_default" ? "모델 미지정" : key,
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
 * 시나리오 1차 정렬 기준: 벤치 실행 순서(`scenarioExecutionOrderIndex`).
 * 미등록 ID·동률은 이름순으로 폴백 — `ResultsTable`의 시나리오 정렬과 동일 기준이라
 * 테이블·레이더·막대 차트의 시나리오 순서가 일치한다.
 */
export function compareScenarioExecutionOrder(a: string, b: string): number {
  return scenarioExecutionOrderIndex(a) - scenarioExecutionOrderIndex(b) || a.localeCompare(b);
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

/**
 * 초당 출력 토큰. provider 보고 실토큰(`usageTokens`)이 있으면(>0) 그것을, 없으면 글자수/4 근사를 쓴다.
 * (shared `tokensPerSecondFromRun`와 동일 산식 — 웹 차트 경로 전용 복제본.)
 */
export function tokensPerSecondFromRun(
  totalMs: number | null | undefined,
  outputText: string | null | undefined,
  usageTokens?: number | null,
): number {
  const ms = totalMs ?? 0;
  if (!ms || ms <= 0) return 0;
  const at = usageTokens != null && usageTokens > 0 ? usageTokens : approxOutputTokens(outputText ?? "");
  if (at <= 0) return 0;
  return at / (ms / 1000);
}

export function scenarioRowKey(scenario: string, api: string, modelId?: string): string {
  const m = modelId ?? "";
  return `${m}|${scenario}|${api}`;
}

/** 라이브 멀티모델 막대 Y축: scenario → API(chat/msg 순) → model → id(안정) */
export function sortChartRowsForBarOrder(rows: ChartRow[]): ChartRow[] {
  return [...rows].sort((a, b) => {
    const s = compareScenarioExecutionOrder(a.scenario, b.scenario);
    if (s !== 0) return s;
    const d = apiRouteRank(a.api) - apiRouteRank(b.api);
    if (d !== 0) return d;
    if (a.api !== b.api) return a.api.localeCompare(b.api);
    const ma = a.modelId ?? "";
    const mb = b.modelId ?? "";
    if (ma !== mb) return ma.localeCompare(mb);
    return a.id.localeCompare(b.id);
  });
}

export function rowsToChartData(
  rows: {
    scenario: string;
    api: string;
    ttft_ms: number | null;
    tpot_ms: number | null;
    pass?: boolean;
    model_id?: string;
    total_ms?: number | null;
    output_text?: string | null;
    usage_output_tokens?: number | null;
    reasoning_hidden?: boolean;
  }[],
): ChartRow[] {
  return rows.map((r, i) => {
    const modelSuffix = r.model_id ? ` · ${r.model_id}` : "";
    const fullLabel = `${r.scenario} (${apiShort(r.api)})${modelSuffix}`;
    const tps = tokensPerSecondFromRun(r.total_ms ?? undefined, r.output_text ?? undefined, r.usage_output_tokens);
    return {
      id: scenarioRowKey(r.scenario, r.api, r.model_id) + `|${i}`,
      labelShort: fullLabel.slice(0, 28) + (fullLabel.length > 28 ? "…" : ""),
      fullLabel,
      scenario: r.scenario,
      api: r.api,
      ttft: r.ttft_ms ?? 0,
      tpot: r.tpot_ms ?? 0,
      tps,
      tpsSource: r.usage_output_tokens != null && r.usage_output_tokens > 0 ? "usage" : "approx",
      reasoningHidden: r.reasoning_hidden,
      pass: r.pass,
      modelId: r.model_id?.trim() || undefined,
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
  byModel: Record<string, { ttft: number; tpot: number; tps: number; pass?: boolean }>;
  /** `compareSeries` 배열 인덱스와 동일 순서 — 모델 id 문자열 불일치 시에도 레이더·막대가 안정적으로 조회됨 */
  bySeriesIndex: Array<{ ttft: number; tpot: number; tps: number; pass?: boolean } | undefined>;
};

function rowMetrics(row: ChartRow): { ttft: number; tpot: number; tps: number; pass?: boolean } {
  return {
    ttft: Number(row.ttft) || 0,
    tpot: Number(row.tpot) || 0,
    tps: Number(row.tps) || 0,
    pass: row.pass,
  };
}

/** 비교 모드: 동일 시나리오·API 키로 피벗 */
export function pivotCompareSeries(series: CompareSeries[]): PivotCompareRow[] {
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
    const s = compareScenarioExecutionOrder(a.scenario, b.scenario);
    if (s !== 0) return s;
    const d = apiRouteRank(a.api) - apiRouteRank(b.api);
    if (d !== 0) return d;
    return a.api.localeCompare(b.api);
  });
  return keyOrder.map((k) => {
    const meta = keyMeta.get(k)!;
    const byModel: Record<string, { ttft: number; tpot: number; tps: number; pass?: boolean }> = {};
    const bySeriesIndex: PivotCompareRow["bySeriesIndex"] = series.map((s) => {
      const row = s.rows.find((r) => r.scenario === meta.scenario && r.api === meta.api);
      if (!row) return undefined;
      const m = rowMetrics(row);
      byModel[s.modelId] = m;
      return m;
    });
    return { label: meta.label, scenario: meta.scenario, api: meta.api, byModel, bySeriesIndex };
  });
}

/** 비교 막대: 시나리오+API+모델 단위 행 — `sortChartRowsForBarOrder`와 동일한 정렬 키 */
export type FlatBarDatum = {
  barLabel: string;
  scenario: string;
  api: string;
  modelId?: string;
  /** 비교 시리즈 인덱스 — TPS 막대 색 구분 등 */
  seriesIndex: number;
  ttft: number;
  tpot: number;
  tps: number;
  pass?: boolean;
  /** 시나리오·API 그룹 사이 빈 Y축 카테고리(비교 멀티 모델 시 삽입) */
  categorySpacer?: true;
};

export function comparePivotToFlatBarData(
  pivoted: PivotCompareRow[],
  compareSeries: CompareSeries[],
): FlatBarDatum[] {
  const out: FlatBarDatum[] = [];
  for (const p of pivoted) {
    compareSeries.forEach((s, si) => {
      const v = p.bySeriesIndex[si];
      const modelLabel = s.label || s.modelId || "모델";
      out.push({
        barLabel: `${p.scenario} (${apiShort(p.api)}) · ${modelLabel}`,
        scenario: p.scenario,
        api: p.api,
        modelId: s.modelId || undefined,
        seriesIndex: si,
        ttft: v?.ttft ?? 0,
        tpot: v?.tpot ?? 0,
        tps: v?.tps ?? 0,
        pass: v?.pass,
      });
    });
  }
  out.sort((a, b) => {
    const s = compareScenarioExecutionOrder(a.scenario, b.scenario);
    if (s !== 0) return s;
    const d = apiRouteRank(a.api) - apiRouteRank(b.api);
    if (d !== 0) return d;
    if (a.api !== b.api) return a.api.localeCompare(b.api);
    const ma = a.modelId ?? "";
    const mb = b.modelId ?? "";
    if (ma !== mb) return ma.localeCompare(mb);
    return a.barLabel.localeCompare(b.barLabel);
  });
  return out;
}
