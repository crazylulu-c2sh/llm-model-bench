import type { ParamTier } from "@llm-bench/shared";
import type { Messages } from "../i18n";

/** 서수 척도 고정 순서 — 필터 칩·배지 렌더링에서 빈도순 대신 항상 이 순서로 표기. */
export const PARAM_TIER_ORDER: readonly ParamTier[] = ["tiny", "small", "medium", "large"];

export const PARAM_TIER_CSS_VAR: Record<ParamTier, string> = {
  tiny: "var(--param-tier-tiny)",
  small: "var(--param-tier-small)",
  medium: "var(--param-tier-medium)",
  large: "var(--param-tier-large)",
};

export function paramTierColor(tier: ParamTier | null): string {
  if (tier == null) return "var(--muted)";
  return PARAM_TIER_CSS_VAR[tier];
}

/** 등급 표시명 — Tiny/Small/Medium/Large는 모든 로케일에서 고정 영어(m.scoreboard.paramTier). */
export function paramTierLabel(tier: ParamTier | null, m: Messages): string {
  return tier == null ? m.scoreboard.paramTierUnknown : m.scoreboard.paramTier[tier];
}
