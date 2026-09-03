import type { LoadTtlStatus } from "@llm-bench/shared";
import { isLmsCliEnabled, lmsPs } from "./lms-cli.js";
import { isTargetOnServerHost } from "./util/localhost.js";

/**
 * JIT prime으로 건 TTL이 **실제로 붙었는지** 확인한다.
 *
 * prime이 2xx를 받아도 적용은 증명되지 않는다(OpenAI 호환 서버는 모르는 body 필드를 조용히 무시한다).
 * 그래서 지금까지 `load_ttl_status`는 `"unknown"`에 머물렀고, 그 모호함 때문에 모델이 TTL 없이
 * 상주하는 것을 한동안 아무도 못 봤다.
 *
 * LM Studio의 REST 목록은 적재 상태조차 주지 않지만(`loaded_instances`가 빈 배열로 온다),
 * `lms ps --json`은 항목마다 `ttlMs`를 준다. 그래서 **로컬 대상 + CLI 사용 가능**일 때만 그걸로 확인한다.
 * 원격 LM Studio에서 `lms ps`는 이 서버 기계의 이야기라 근거가 되지 못하므로 확인하지 않는다.
 */

/** `lms ps` JSON 항목이 이 모델인지 — LM Studio는 modelKey·identifier를 같은 값으로 준다. */
const ID_KEYS = ["modelKey", "identifier", "id", "key", "model"] as const;

/**
 * @returns ttl(ms) — 양수면 TTL이 걸려 있다. `null`이면 "TTL 없음"이 확인된 것,
 *          `undefined`면 **판정 보류**(형식을 못 읽었거나 모델이 목록에 없거나 필드가 아예 없음).
 */
export function findLmsTtlMs(stdout: string, modelId: string): number | null | undefined {
  const trimmed = stdout.trim();
  // `lms ps`가 --json을 못 받아 평문으로 떨어진 경우엔 ttl을 읽을 수 없다 — 추측하지 않는다.
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const list = Array.isArray(parsed)
    ? parsed
    : ((parsed as { models?: unknown[]; loaded?: unknown[] })?.models ??
      (parsed as { loaded?: unknown[] })?.loaded ??
      []);
  if (!Array.isArray(list)) return undefined;

  const wanted = modelId.trim();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const matched = ID_KEYS.some((k) => typeof obj[k] === "string" && (obj[k] as string).trim() === wanted);
    if (!matched) continue;
    const ttl = obj.ttlMs ?? obj.ttl_ms;
    if (typeof ttl === "number" && Number.isFinite(ttl)) return ttl > 0 ? ttl : null;
    // 항목은 찾았는데 ttl 필드가 없다 — 이 빌드가 안 내보내는 것일 수 있으므로 "없다"고 단정하지 않는다.
    return undefined;
  }
  return undefined; // 목록에 없다 = 적재 여부부터 불확실 → 보류
}

/**
 * @returns 확정된 상태, 또는 `null`(= 확인 불가라 기존 상태를 유지하라).
 * 실패는 전부 `null`로 흡수한다 — TTL 확인 때문에 벤치가 죽어선 안 된다.
 */
export async function verifyLmStudioTtlApplied(args: {
  baseUrl: string;
  modelId: string;
  /** `lms ps` 타임아웃(ms). 로드 직후 한 번만 부르므로 짧게 잡는다. */
  timeoutMs?: number;
}): Promise<LoadTtlStatus | null> {
  // `lms ps`는 이 서버 기계의 LM Studio를 본다 — 원격 대상이면 남의 이야기다.
  if (!isTargetOnServerHost(args.baseUrl)) return null;
  if (!isLmsCliEnabled()) return null;
  try {
    const r = await lmsPs(args.timeoutMs ?? 4000);
    if (!r.ok || !r.stdout) return null;
    const ttl = findLmsTtlMs(r.stdout, args.modelId);
    if (ttl === undefined) return null;
    return ttl === null ? "not_applied" : "applied";
  } catch {
    return null;
  }
}
