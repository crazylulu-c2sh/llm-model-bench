import type { ReasoningEffort } from "@llm-bench/shared";

/**
 * reasoning_effort 배지 색 — Claude Code(gold→green→lavender→violet) + Codex high 가시성(오렌지).
 * Primer 기존 토큰만 사용(DESIGN.md / 대비 게이트).
 */
export function reasoningEffortColor(
  effort: ReasoningEffort | string | null | undefined,
): string {
  switch (effort) {
    case "low":
      return "var(--warning)";
    case "medium":
      return "var(--accent-2)";
    case "high":
      return "var(--tier-okay)";
    case "xhigh":
      return "var(--chart-tps)";
    case "none":
    case "minimal":
    default:
      return "var(--muted)";
  }
}
