import type { StressWorkloadId } from "@llm-bench/shared";

export const WORKLOAD_LABEL: Record<StressWorkloadId, string> = {
  stress_ping: "짧은 ping (영어)",
  stress_short_reply: "짧은 문장 응답 (영어)",
  stress_short_reply_ko: "짧은 문장 응답 (한국어)",
  stress_short_reply_ja: "짧은 문장 응답 (일본어)",
};

export function workloadLabel(id: string): string {
  return (WORKLOAD_LABEL as Record<string, string | undefined>)[id] ?? id;
}
