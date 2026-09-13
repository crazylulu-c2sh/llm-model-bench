import { createHash } from "node:crypto";

/** Only workload settings belong here: lifecycle, selected scenarios and repetition counts do not. */
const FIELDS = [
  "temperature", "max_tokens", "request_max_tokens", "profile_max_tokens_override", "seed", "effective_sampling", "stop", "extra_body",
  "reasoning_effort", "profile_id", "profile_version", "profile_preset", "profile_task_mode",
  "profile_thinking_intent", "profile_preserve_thinking", "prompt_rules_applied",
  "scenario_bundle_version", "evaluation_protocol_version", "warmup_protocol_version",
] as const;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function benchConfig(meta: Record<string, unknown>, runId: string) {
  const complete = typeof meta.temperature === "number" && typeof meta.max_tokens === "number"
    && Object.hasOwn(meta, "request_max_tokens") && Object.hasOwn(meta, "profile_max_tokens_override")
    && typeof meta.scenario_bundle_version === "string" && Object.hasOwn(meta, "seed")
    && (meta.profile_id == null || (typeof meta.profile_version === "number"
      && meta.effective_sampling != null && typeof meta.profile_thinking_intent === "string"));
  const settings = Object.fromEntries(FIELDS.map((k) => [k, meta[k] ?? null]));
  const canonical = canonicalJson({ version: 1, settings, ...(!complete ? { legacy_run_id: runId } : {}) });
  return {
    config_id: `v1:${createHash("sha256").update(canonical).digest("hex")}`,
    config: settings,
    config_complete: complete,
  };
}
