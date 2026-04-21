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

function apiShort(api: string): string {
  if (api === "chat_completions") return "chat";
  if (api === "messages") return "msg";
  return api;
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
      modelId: r.model_id,
    };
  });
}

export function avg(nums: number[]): number | undefined {
  const v = nums.filter((n) => Number.isFinite(n) && n > 0);
  if (!v.length) return undefined;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** 비교 모드: 동일 시나리오·API 키로 피벗 */
export function pivotCompareSeries(series: CompareSeries[]): {
  label: string;
  scenario: string;
  api: string;
  byModel: Record<string, { ttft: number; tpot: number; tps: number; pass?: boolean }>;
}[] {
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
  return keyOrder.map((k) => {
    const meta = keyMeta.get(k)!;
    const byModel: Record<string, { ttft: number; tpot: number; tps: number; pass?: boolean }> = {};
    for (const s of series) {
      const row = s.rows.find((r) => `${r.scenario}\t${r.api}` === k);
      if (row) {
        byModel[s.modelId] = { ttft: row.ttft, tpot: row.tpot, tps: row.tps, pass: row.pass };
      }
    }
    return { label: meta.label, scenario: meta.scenario, api: meta.api, byModel };
  });
}
