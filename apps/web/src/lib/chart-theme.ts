// recharts 차트가 공유하는 테마 객체·눈금 유틸. (BenchCharts·ScoreboardChart 공용 — 복제 금지.)

/** Recharts 기본 스타일이 툴팁 자식에 검정 텍스트를 남기지 않도록 공통 지정(테마 토큰). */
export const rechartsTooltipShell = {
  contentStyle: {
    background: "var(--chart-tooltip-bg)",
    border: "1px solid var(--chart-tooltip-border)",
    fontSize: 12,
    color: "var(--chart-tooltip-fg)",
  },
  labelStyle: {
    color: "var(--chart-tooltip-label)",
    marginBottom: 4,
    fontSize: 11,
    fontWeight: 500,
  },
  itemStyle: { color: "var(--chart-tooltip-fg)" },
  cursor: { fill: "var(--chart-cursor)" },
} as const;

/** 1·2·5 ×10^k 단위로 올림 — 축 상한을 '깔끔한' 눈금이 떨어지는 값으로. */
export function niceCeil(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const base = 10 ** exp;
  const f = x / base; // 1..10
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * base;
}

/** 차트 레이블(축 틱·범례) 말줄임 — 뒤에서부터 자르고 "…" 부착. 전체 텍스트는 별도 툴팁으로. */
export function truncateChartLabel(label: string, max = 28): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}
