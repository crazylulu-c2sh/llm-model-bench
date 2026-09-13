import type { ContentionObservation } from "@llm-bench/shared";

type MtplxState = NonNullable<ContentionObservation["mtplx"]>;
const object = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const count = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;

/** Allowlisted diagnostics only: never retain health bodies, model paths or credentials. */
export function parseMtplxHealth(value: unknown): MtplxState | undefined {
  const root = object(value);
  const scheduler = object(root?.scheduler);
  const keepalive = object(root?.gpu_keepalive);
  if (root?.ok !== true || typeof root.generation_mode !== "string" ||
      typeof scheduler?.mode !== "string" || typeof keepalive?.enabled !== "boolean") return;
  const active = count(root.active_requests);
  const scheduled = count(scheduler.active_requests);
  const foreground = count(root.foreground_active);
  if (active === undefined || scheduled === undefined || foreground === undefined) return;
  const lanes = [object(scheduler.ar_batch), object(scheduler.mtp_batch)];
  let laneOutstanding = 0;
  let pending = 0;
  for (const lane of lanes) {
    if (!lane || Object.keys(lane).length === 0) continue;
    const a = count(lane.active), p = count(lane.pending);
    if (a === undefined || p === undefined) return;
    laneOutstanding += a + p;
    pending += p;
  }
  // Top-level counters overlap with dashboard/foreground and scheduler counters.
  return {
    outstanding: Math.max(active, scheduled, foreground, laneOutstanding),
    pending,
    active,
    scheduler_active: scheduled,
    foreground_active: foreground,
    requests_completed: count(root.requests_completed),
    requests_cancelled: count(root.requests_cancelled),
    keepalive_enabled: keepalive.enabled,
    keepalive_attentive: typeof keepalive.attentive === "boolean" ? keepalive.attentive : undefined,
  };
}
