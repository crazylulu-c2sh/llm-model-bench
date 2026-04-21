export type ChartRow = {
  id: string;
  labelShort: string;
  scenario: string;
  api: string;
  ttft: number;
  tpot: number;
  pass?: boolean;
};

export function rowsToChartData(rows: { scenario: string; api: string; ttft_ms: number | null; tpot_ms: number | null; pass?: boolean }[]): ChartRow[] {
  return rows.map((r, i) => ({
    id: `${r.scenario}|${r.api}|${i}`,
    labelShort:
      `${r.scenario.slice(0, 8)}${r.scenario.length > 8 ? "…" : ""}·${r.api === "chat_completions" ? "chat" : r.api === "messages" ? "msg" : r.api}`.slice(0, 22),
    scenario: r.scenario,
    api: r.api,
    ttft: r.ttft_ms ?? 0,
    tpot: r.tpot_ms ?? 0,
    pass: r.pass,
  }));
}

export function avg(nums: number[]): number | undefined {
  const v = nums.filter((n) => Number.isFinite(n) && n > 0);
  if (!v.length) return undefined;
  return v.reduce((a, b) => a + b, 0) / v.length;
}
