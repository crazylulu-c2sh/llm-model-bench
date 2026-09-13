import type { ContentionObservation } from "@llm-bench/shared";
import { msg } from "../i18n";

export function contentionReasonText(observation: ContentionObservation | undefined, fallback: string): string {
  if (!observation) return fallback;
  const t = msg().bench;
  const labels: string[] = [];
  if (observation.reasons.some((r) => /^(mtplx_outstanding|server_running|lms_generating)/.test(r))) labels.push(t.guardServerBusy);
  if (observation.reasons.some((r) => r.startsWith("gpu_util="))) labels.push(t.guardGpuBusy);
  if (observation.reasons.includes("idle_confirmation_pending")) labels.push(t.guardIdlePending);
  if (observation.mtplx_status !== "available" && !observation.prometheus_available && !observation.lms_available) labels.push(t.guardServerUnknown);
  return labels.length ? labels.join(" · ") : fallback;
}
