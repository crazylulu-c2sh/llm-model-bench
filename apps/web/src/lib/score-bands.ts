// 스코어보드 표·차트가 공유하는 점수 밴드 색·caveat 문구·그룹/지표 라벨.
// (표 Scoreboard.tsx와 차트 ScoreboardChart.tsx가 동일 색·문구를 쓰도록 여기 한 곳에서 정의.)
import type { LeakMetric } from "./leak-metrics";
import { AGENT_SAFE_THRESHOLDS } from "./leak-metrics";

// CAP_TITLE·APPROX_TITLE·GROUP_LABEL·METRIC_LABEL 문구는 i18n 카탈로그(m.scoreboard)로 이전됨.

/** 절대 점수 밴드 → 색(기존 tps-tier 토큰 재사용; 비교 상대값 아님). */
export type ScoreBand = "high" | "good" | "mid" | "low";
export const BAND_COLOR: Record<ScoreBand, string> = {
  high: "var(--tier-fast)", // 초록
  good: "var(--tier-good)", // 노랑
  mid: "var(--tier-okay)", // 주황
  low: "var(--tier-slow)", // 빨강
};

/** 품질 밴드: ≥90 / 70~89 / 50~69 / <50. */
export function qualityBand(v: number): ScoreBand {
  if (v >= 90) return "high";
  if (v >= 70) return "good";
  if (v >= 50) return "mid";
  return "low";
}

/** 속도 밴드(상대): 상한 없는 점수라 절대 임계 대신 열 내 최고점 대비 비율로 색칠. ≥0.9 / 0.75 / 0.5. */
export function speedRelativeBand(value: number, max: number): ScoreBand {
  const r = max > 0 ? value / max : 0;
  if (r >= 0.9) return "high";
  if (r >= 0.75) return "good";
  if (r >= 0.5) return "mid";
  return "low";
}

// ─── #80: 누수/정체 지표(모델 × 라우트) — 낮을수록 좋음(agent-safe) ───────────────
// 표시 라벨/설명(사고 누수 등)은 i18n 카탈로그(m.monitor.leakMetricLabel/Title)로 이전.
const LEAK_THRESHOLD: Record<LeakMetric, number> = {
  thinking_leak: AGENT_SAFE_THRESHOLDS.thinking_leak_ratio,
  empty_turn: AGENT_SAFE_THRESHOLDS.empty_turn_rate,
  channel_tag: AGENT_SAFE_THRESHOLDS.channel_tag_leak,
};

/** 누수 밴드(낮을수록 좋음): ≤임계 → high(초록), ≤3×임계 → good, ≤6×임계 → mid, 그 이상 low(빨강). */
export function leakBand(value: number | null, metric: LeakMetric): ScoreBand {
  if (value == null) return "high"; // 측정 불가(예: 출력 없음)는 경고 아님
  const t = LEAK_THRESHOLD[metric];
  if (value <= t) return "high";
  if (value <= t * 3) return "good";
  if (value <= t * 6) return "mid";
  return "low";
}
