import type { DetectResult, FitPolicy, SystemSnapshot } from "@llm-bench/shared";
import type { FetchLike } from "./detect.js";
import {
  lmStudioListModels,
  lmStudioModelSizeBytes,
  lmStudioResidentInstances,
} from "./lmstudio.js";
import { getSystemSnapshot } from "./system-info.js";

/** repro(25.71→28.28GB ≈ +10%)에 맞춘 런타임/KV 오버헤드 계수. */
export const FIT_OVERHEAD_FACTOR = 1.1;
/** OS·기타 프로세스용 여유 예약(바이트) — 이만큼 남기고 계산. */
export const FIT_SAFETY_RESERVE_BYTES = 2 * 1024 ** 3;

export type ResidentInstance = {
  modelKey: string;
  instanceId: string;
  ramBytes?: number;
  vramBytes?: number;
};

export type PreflightMemoryFitEvent = {
  model_id: string;
  /** 후보 필요 RAM(오버헤드 적용 전 raw `size_bytes`). 미상이면 null. */
  required_bytes: number | null;
  free_bytes: number;
  resident_ram_bytes: number;
  will_fit: boolean;
  action: "proceed" | "unload_other_models" | "skip";
  reason: string;
  size_source: "list" | "detect" | "unknown";
};

export type FitDecision = {
  action: "proceed" | "unload_other_models" | "skip";
  event: PreflightMemoryFitEvent;
  /** `unload_other_models`일 때 회수 대상 인스턴스. 그 외엔 정보용. */
  residentInstances: ResidentInstance[];
};

function gib(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

/**
 * #81: 후보를 로드하기 전 시스템 RAM 여유 vs 필요량을 예측한다(repro는 "insufficient system resources").
 * 항상 예측을 담은 event를 반환(정책 미지정이어도 로그용). 정책이 `skip`/`unload_other_models`일 때만
 * `action`이 바뀐다. 후보 크기를 알 수 없으면 절대 막지 않고 `proceed`(하위호환).
 */
export async function preflightMemoryFit(args: {
  base: string;
  modelId: string;
  apiKey?: string;
  fitPolicy?: FitPolicy;
  detect: DetectResult;
  fetchImpl: FetchLike;
  /** 테스트 주입용. 미지정 시 getSystemSnapshot(os.freemem()). */
  systemInfoImpl?: () => SystemSnapshot;
}): Promise<FitDecision> {
  const { base, modelId, apiKey, fitPolicy, detect, fetchImpl } = args;
  const getSystem = args.systemInfoImpl ?? getSystemSnapshot;

  const listed = await lmStudioListModels(base, { fetchImpl, apiKey, timeoutMs: 5000 });
  const models = listed.ok ? listed.models : [];

  // 후보 크기: LM Studio 목록의 size_bytes 우선, detect의 size_bytes 폴백.
  let required = lmStudioModelSizeBytes(models, modelId) ?? null;
  let sizeSource: "list" | "detect" | "unknown" = required != null ? "list" : "unknown";
  if (required == null) {
    const fromDetect = detect.models.find((m) => m.id === modelId)?.size_bytes;
    if (typeof fromDetect === "number" && fromDetect > 0) {
      required = fromDetect;
      sizeSource = "detect";
    }
  }

  const free = getSystem().freeMemBytes;
  const residents = lmStudioResidentInstances(models, modelId);
  const residentRam = residents.reduce((s, r) => s + (r.ramBytes ?? 0), 0);

  // 크기 미상이면 예측 불가 → 로그만 하고 진행(막지 않음).
  if (required == null) {
    return {
      action: "proceed",
      event: {
        model_id: modelId,
        required_bytes: null,
        free_bytes: free,
        resident_ram_bytes: residentRam,
        will_fit: true,
        action: "proceed",
        reason: "preflight_skipped: 후보 크기(size_bytes) 미상",
        size_source: "unknown",
      },
      residentInstances: [],
    };
  }

  const requiredWithOverhead = Math.ceil(required * FIT_OVERHEAD_FACTOR);
  const willFit = requiredWithOverhead <= free - FIT_SAFETY_RESERVE_BYTES;
  const common = {
    model_id: modelId,
    required_bytes: required,
    free_bytes: free,
    resident_ram_bytes: residentRam,
    will_fit: willFit,
    size_source: sizeSource,
  } as const;

  if (willFit) {
    return {
      action: "proceed",
      event: {
        ...common,
        action: "proceed",
        reason: `fits — needs ~${gib(requiredWithOverhead)}GB, ${gib(free)}GB free`,
      },
      residentInstances: [],
    };
  }

  const fitsAfterUnload = requiredWithOverhead <= free + residentRam - FIT_SAFETY_RESERVE_BYTES;
  if (fitPolicy === "unload_other_models" && fitsAfterUnload && residents.length > 0) {
    return {
      action: "unload_other_models",
      event: {
        ...common,
        action: "unload_other_models",
        reason: `unloading ${residents.length} resident instance(s) to fit — needs ~${gib(
          requiredWithOverhead,
        )}GB, ${gib(free)}GB free + ${gib(residentRam)}GB resident`,
      },
      residentInstances: residents,
    };
  }

  // 안 맞음. `skip`(또는 회수해도 부족한 `unload_other_models`)만 중단; 미지정은 예측만 로그하고 진행.
  if (fitPolicy === "skip" || fitPolicy === "unload_other_models") {
    const evenAfter = fitPolicy === "unload_other_models" ? " (언로드해도 부족)" : "";
    return {
      action: "skip",
      event: {
        ...common,
        action: "skip",
        reason: `won't fit — needs ${gib(requiredWithOverhead)}GB, ${gib(free)}GB free${evenAfter}`,
      },
      residentInstances: residents,
    };
  }

  return {
    action: "proceed",
    event: {
      ...common,
      action: "proceed",
      reason: `예측: 안 맞을 수 있음 — needs ~${gib(requiredWithOverhead)}GB, ${gib(
        free,
      )}GB free (fitPolicy 미지정 → 진행)`,
    },
    residentInstances: [],
  };
}
