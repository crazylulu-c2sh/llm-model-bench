export type ChartRow = {
  id: string;
  labelShort: string;
  /** Y축(가로 차트) 전체 라벨 */
  fullLabel: string;
  scenario: string;
  api: string;
  ttft: number;
  tpot: number;
  /** 근사 초당 출력 토큰; 0이면 막대 미표시에 가깝게 처리 */
  tps: number;
  pass?: boolean;
  modelId?: string;
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

export function tokensPerSecondFromRun(totalMs: number | null | undefined, outputText: string | null | undefined): number {
  const ms = totalMs ?? 0;
  if (!ms || ms <= 0) return 0;
  const at = approxOutputTokens(outputText ?? "");
  if (at <= 0) return 0;
  return at / (ms / 1000);
}

export function scenarioRowKey(scenario: string, api: string, modelId?: string): string {
  const m = modelId ?? "";
  return `${m}|${scenario}|${api}`;
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
  }[],
): ChartRow[] {
  return rows.map((r, i) => {
    const modelSuffix = r.model_id ? ` · ${r.model_id}` : "";
    const fullLabel = `${r.scenario} (${apiShort(r.api)})${modelSuffix}`;
    const tps = tokensPerSecondFromRun(r.total_ms ?? undefined, r.output_text ?? undefined);
    return {
      id: scenarioRowKey(r.scenario, r.api, r.model_id) + `|${i}`,
      labelShort: fullLabel.slice(0, 28) + (fullLabel.length > 28 ? "…" : ""),
      fullLabel,
      scenario: r.scenario,
      api: r.api,
      ttft: r.ttft_ms ?? 0,
      tpot: r.tpot_ms ?? 0,
      tps,
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

/** 양의 값만 사용해 오름차순 정렬 후 ≈95백분위(레이더 분모 캡). 비어 있으면 1. */
export function percentile95Cap(values: number[]): number {
  const v = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!v.length) return 1;
  const idx = Math.min(v.length - 1, Math.max(0, Math.ceil(0.95 * v.length) - 1));
  return Math.max(1, v[idx] ?? 1);
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
    if (a.scenario !== b.scenario) return a.scenario.localeCompare(b.scenario);
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
