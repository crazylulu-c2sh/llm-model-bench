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

/** Workload settings only — no per-run isolation. Complete `config_id` hashes this payload. */
export function benchSettingsCanonical(meta: object): string {
  const rec = meta as Record<string, unknown>;
  const settings = Object.fromEntries(FIELDS.map((k) => [k, rec[k] ?? null]));
  return canonicalJson({ version: 1, settings });
}

/**
 * 완전 메타는 런마다 같은 `config_id`를 갖는다.
 * `profile_id === "unknown"`은 정의가 없어 `profile_version`이 비더라도, 큐가 붙인 샘플링·사고
 * 의도가 있으면 완전으로 본다 — 그렇지 않으면 갭 채우기 부분 실행이 스코어보드 섬을 만든다.
 */
export function isBenchConfigComplete(meta: object): boolean {
  const rec = meta as Record<string, unknown>;
  if (typeof rec.temperature !== "number" || typeof rec.max_tokens !== "number") return false;
  if (!Object.hasOwn(rec, "request_max_tokens") || !Object.hasOwn(rec, "profile_max_tokens_override")) return false;
  if (typeof rec.scenario_bundle_version !== "string" || !Object.hasOwn(rec, "seed")) return false;
  if (rec.profile_id == null) return true;
  if (rec.effective_sampling == null || typeof rec.profile_thinking_intent !== "string") return false;
  if (rec.profile_id === "unknown") return true;
  return typeof rec.profile_version === "number";
}

export function benchConfig(meta: object, runId: string) {
  const rec = meta as Record<string, unknown>;
  const complete = isBenchConfigComplete(rec);
  const settings = Object.fromEntries(FIELDS.map((k) => [k, rec[k] ?? null]));
  const canonical = complete
    ? benchSettingsCanonical(rec)
    : canonicalJson({ version: 1, settings, legacy_run_id: runId });
  return {
    config_id: `v1:${createHash("sha256").update(canonical).digest("hex")}`,
    config: settings,
    config_complete: complete,
  };
}
