/** 결과 테이블·드로어용 TTFT 표시 — 100ms 미만은 소수 1자리, 이상은 정수 반올림. */
export function formatTtftMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 100) return ms.toFixed(1);
  return String(Math.round(ms));
}

/** 디코드 tok/s 표시 — 소수 1자리 반올림(BenchCharts 하우스 스타일). null → "—". */
export function formatTps(tps: number | null | undefined): string {
  if (tps == null || !Number.isFinite(tps)) return "—";
  return String(Math.round(tps * 10) / 10);
}
