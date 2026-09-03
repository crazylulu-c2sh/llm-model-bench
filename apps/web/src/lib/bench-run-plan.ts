import type { BenchQueueModelStatus, BenchQueueSnapshot, BenchRunMeta } from "@llm-bench/shared";
import { scenarioRowKey } from "../components/chart-types";

/**
 * 실행 중(또는 직전) 런의 **권위 있는 계획**.
 *
 * 진행률·예약 스켈레톤·ETA·스코어보드는 원래 폼 상태(`benchQueueDraft` × 선택 시나리오 × 라우트)에서
 * 나왔는데, 새로고침 후 재접속한 탭은 그 폼 상태가 없다 — 그래서 분모가 0이 되어 헤더가
 * "0/0 (0%)"에 굳고 예약 행·ETA·스코어보드가 통째로 사라졌다. 서버 큐 스냅샷과 `run_started.meta`가
 * 실제로 무엇을 돌고 있는지 알고 있으므로, 그쪽을 단일 소스로 삼는다.
 */
export type BenchRunPlan = {
  /** 서버 소유 큐 id. 일시정지·정지 라우트의 대상이기도 하다. */
  queueId: string | null;
  /** 큐 전체 실행 순서 */
  modelIds: string[];
  /** 지금 실행 중인 모델의 큐 인덱스 */
  index: number;
  /** 서버가 실제로 실행하는 시나리오. 모르면 빈 배열 — 지어내지 않는다. */
  scenarioIds: string[];
  apiRoutes: string[];
  warmupRuns: number;
  measuredRuns: number;
  /** 이미 끝난(또는 중지된) 모델. `runId`가 있어야 DB에서 결과를 복원할 수 있다. */
  done: Array<{ modelId: string; runId: string | null; status: BenchQueueModelStatus }>;
  statusById: Record<string, BenchQueueModelStatus>;
  source: "local" | "server";
};

/** 파생값이 실제로 읽는 뷰. 계획이 없으면 폼으로 폴백해 **실행 전 동작을 그대로 보존**한다. */
export type BenchPlanView = {
  modelIds: string[];
  scenarioIds: string[];
  apiRoutes: string[];
  hasPlan: boolean;
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * `GET /bench/running`의 큐 스냅샷 → 실행 계획.
 * 스냅샷이 망가져 있으면(구버전 서버·부분 응답) 계획 없음으로 떨어뜨린다 — 재연결 자체는 살려야 한다.
 */
export function planFromQueueSnapshot(snapshot: BenchQueueSnapshot | null | undefined): BenchRunPlan | null {
  if (!snapshot || typeof snapshot.queue_id !== "string") return null;
  const models = Array.isArray(snapshot.models) ? snapshot.models : [];
  if (models.length === 0) return null;
  const modelIds = models.map((m) => m.model_id);
  const rawIndex = typeof snapshot.index === "number" ? snapshot.index : 0;
  const plan = snapshot.plan;
  const statusById: Record<string, BenchQueueModelStatus> = {};
  for (const m of models) statusById[m.model_id] = m.status;
  return {
    queueId: snapshot.queue_id,
    modelIds,
    // 완료 큐는 index가 models.length라 범위를 벗어난다 — 마지막 위치로 보정한다.
    index: Math.min(Math.max(rawIndex, 0), Math.max(modelIds.length - 1, 0)),
    scenarioIds: plan && isStringArray(plan.scenario_ids) ? plan.scenario_ids : [],
    apiRoutes: plan && isStringArray(plan.api_routes) ? plan.api_routes : [],
    warmupRuns: typeof plan?.warmup_runs === "number" ? plan.warmup_runs : 1,
    measuredRuns: typeof plan?.measured_runs === "number" ? plan.measured_runs : 3,
    done: models
      .filter((m) => m.status !== "pending" && m.status !== "running")
      .map((m) => ({ modelId: m.model_id, runId: m.run_id, status: m.status })),
    statusById,
    source: "server",
  };
}

/** 새 실행을 시작할 때, `queue_started`가 오기 전까지 쓸 잠정 계획. */
export function planFromForm(input: {
  modelIds: string[];
  scenarioIds: string[];
  apiRoutes: string[];
}): BenchRunPlan {
  return {
    queueId: null,
    modelIds: [...input.modelIds],
    index: 0,
    scenarioIds: [...input.scenarioIds],
    apiRoutes: [...input.apiRoutes],
    warmupRuns: 1,
    measuredRuns: 3,
    done: [],
    statusById: Object.fromEntries(input.modelIds.map((id) => [id, "pending" as BenchQueueModelStatus])),
    source: "local",
  };
}

/**
 * `run_started.meta`가 도착하면 시나리오·라우트를 **확정**한다. 서버가 계획을 주지 못한 재연결
 * (구버전·버퍼 축출)에서도 이 경로로 계획이 채워진다. 모델 목록·인덱스·완료 정보는 건드리지 않는다.
 */
export function mergePlanWithRunMeta(
  plan: BenchRunPlan | null,
  meta: Partial<Pick<BenchRunMeta, "scenario_ids" | "api_routes" | "warmup_runs" | "measured_runs">> | null | undefined,
  modelId: string,
): BenchRunPlan | null {
  if (!meta) return plan;
  const scenarioIds = isStringArray(meta.scenario_ids) && meta.scenario_ids.length ? meta.scenario_ids : null;
  const apiRoutes = isStringArray(meta.api_routes) && meta.api_routes.length ? meta.api_routes : null;
  const warmupRuns = typeof meta.warmup_runs === "number" ? meta.warmup_runs : null;
  const measuredRuns = typeof meta.measured_runs === "number" ? meta.measured_runs : null;
  if (!plan) {
    if (!scenarioIds && !apiRoutes) return null;
    return {
      queueId: null,
      modelIds: [modelId],
      index: 0,
      scenarioIds: scenarioIds ?? [],
      apiRoutes: apiRoutes ?? [],
      warmupRuns: warmupRuns ?? 1,
      measuredRuns: measuredRuns ?? 3,
      done: [],
      statusById: { [modelId]: "running" },
      source: "server",
    };
  }
  return {
    ...plan,
    scenarioIds: scenarioIds ?? plan.scenarioIds,
    apiRoutes: apiRoutes ?? plan.apiRoutes,
    warmupRuns: warmupRuns ?? plan.warmupRuns,
    measuredRuns: measuredRuns ?? plan.measuredRuns,
  };
}

/** 계획이 있으면 계획을, 없으면 폼을 — 실행 전(idle) 동작이 이전과 바이트 단위로 같아야 한다. */
export function resolvePlanView(input: {
  plan: BenchRunPlan | null;
  draftModelIds: string[];
  formScenarioIds: string[];
  formApiRoutes: string[];
}): BenchPlanView {
  const { plan } = input;
  if (!plan) {
    return {
      modelIds: input.draftModelIds,
      scenarioIds: input.formScenarioIds,
      apiRoutes: input.formApiRoutes,
      hasPlan: false,
    };
  }
  return {
    modelIds: plan.modelIds,
    // 서버가 계획을 못 준 구간에서는 폼 값이라도 쓰는 편이 0/0보다 낫다.
    scenarioIds: plan.scenarioIds.length ? plan.scenarioIds : input.formScenarioIds,
    apiRoutes: plan.apiRoutes.length ? plan.apiRoutes : input.formApiRoutes,
    hasPlan: true,
  };
}

/** 진행률. 시나리오를 모르면 총량 0을 돌려준다 — 0/0을 100%로 만들지 않는다. */
export function planTotals(
  view: BenchPlanView,
  completedCount: number,
): { completed: number; total: number; pct: number } {
  const routeCount = Math.max(view.apiRoutes.length, 1);
  const total = view.modelIds.length * view.scenarioIds.length * routeCount;
  const completed = Math.max(0, completedCount);
  // 복원한 행이 계획보다 많을 수 있다(계획이 줄어든 재연결) — 100%를 넘기지 않는다.
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  return { completed, total, pct };
}

export type PendingUnit = { rowKey: string; model_id: string; scenario: string; api: string };

/** 아직 결과가 없는 (모델 × 시나리오 × 라우트) 조합 — 예약 스켈레톤 행과 ETA의 단위. */
export function planPendingUnits(
  view: BenchPlanView,
  completedRowKeys: ReadonlySet<string>,
): PendingUnit[] {
  if (view.apiRoutes.length === 0 || view.scenarioIds.length === 0) return [];
  const out: PendingUnit[] = [];
  for (const modelId of view.modelIds) {
    for (const scenario of view.scenarioIds) {
      for (const api of view.apiRoutes) {
        const rowKey = scenarioRowKey(scenario, api, modelId);
        if (!completedRowKeys.has(rowKey)) out.push({ rowKey, model_id: modelId, scenario, api });
      }
    }
  }
  return out;
}

/** 재접속 직후의 큐 칩 — 완료/진행/대기를 한 번에 채운다. */
export function hydrateQueueStatus(plan: BenchRunPlan): Record<string, BenchQueueModelStatus> {
  return { ...plan.statusById };
}

/** DB 복원 행 병합 — 라이브 행이 언제나 이긴다(복원이 늦게 끝나도 현재 모델을 덮지 않는다). */
export function mergeByRowKey<T extends { rowKey: string }>(
  live: readonly T[],
  restored: readonly T[],
): T[] {
  const seen = new Set(live.map((r) => r.rowKey));
  const out = [...live];
  for (const r of restored) {
    if (seen.has(r.rowKey)) continue;
    seen.add(r.rowKey);
    out.push(r);
  }
  return out;
}
