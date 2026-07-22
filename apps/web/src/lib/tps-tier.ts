import type { Messages } from "../i18n";

export type TpsTier = "fast" | "good" | "okay" | "slow";

/**
 * chat 스트리밍 UI에서 한 사용자가 체감하는 tok/s 기준 (v1 고정값).
 * 한국어 chat 가정: 빠른 읽기 ≈ 4–5 wps × 토큰/단어 ≈ 5–7 tps 부근이 "한 토큰씩 또각또각"의 경계.
 *
 * 주의: 스트레스 벤치의 `tps_per_user`는 stage 평균 처리량(성공 요청 출력 토큰 합 / 단계 시간 / 동시성)이며,
 * 단일 요청 스트림의 순간 TPS와 다를 수 있습니다. 짧은 응답 워크로드(stress_ping 등)는 구조적으로 낮게 나옵니다.
 * v2에서 워크로드별/사용자 설정으로 분리.
 */
export const TPS_TIER_THRESHOLDS = {
  fast: 30,
  good: 15,
  okay: 5,
} as const;

// TPS 체감 등급 표시 라벨은 i18n 카탈로그(m.stress.tpsTier)로 이전.
export const TPS_TIER_CSS_VAR: Record<TpsTier, string> = {
  fast: "var(--tier-fast)",
  good: "var(--tier-good)",
  okay: "var(--tier-okay)",
  slow: "var(--tier-slow)",
};

export function getTpsTier(
  tps: number | null | undefined,
  unreliable: boolean,
): TpsTier | null {
  if (unreliable) return null;
  if (tps == null || !Number.isFinite(tps)) return null;
  if (tps >= TPS_TIER_THRESHOLDS.fast) return "fast";
  if (tps >= TPS_TIER_THRESHOLDS.good) return "good";
  if (tps >= TPS_TIER_THRESHOLDS.okay) return "okay";
  return "slow";
}

export function tpsTierColor(tier: TpsTier | null): string {
  if (tier == null) return "var(--muted)";
  return TPS_TIER_CSS_VAR[tier];
}

export function formatStressTpsTooltip(
  value: number | null | undefined,
  opts: { unreliable: boolean; tier: TpsTier | null },
  s: Messages["stress"],
): string {
  if (opts.unreliable) return s.tpsUnreliableTooltip;
  if (value == null || !Number.isFinite(value)) return "—";
  if (opts.tier == null) return `${value}`;
  return `${value} (${s.tpsTier[opts.tier]})`;
}
