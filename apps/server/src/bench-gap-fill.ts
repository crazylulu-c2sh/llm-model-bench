import type { BenchGapPreviewModel, BenchProfileIntent, DetectResult } from "@llm-bench/shared";
import { benchSettingsCanonical } from "./bench-config.js";
import { makeBenchRunMeta } from "./bench-runner.js";
import {
  benchRequestForQueueModel,
  type BenchQueueBaseRequest,
} from "./bench-queue-runner.js";
import { normBaseUrl } from "./http-shared.js";
import type { DatabaseSync } from "node:sqlite";

/**
 * 현재 벤치 설정으로 아직 실측이 없는 시나리오만 골라 큐에 넣는 갭 채우기.
 *
 * 통계·스코어보드의 설정 본문(`benchSettingsCanonical`)과 같은 그룹을 쓴다.
 * 저장 `config_id`는 불완전 메타에 run_id를 섞지만, 갭 판정은 설정 본문만 비교한다.
 * 시나리오 선택·반복 횟수는 설정에 들어가지 않으므로, 후보 집합은 요청의 scenarioIds다.
 */

export type GapFillPlan = {
  models: BenchGapPreviewModel[];
  runnableModelIds: string[];
  scenarioIdsByModel: Record<string, string[]>;
  unionScenarioIds: string[];
};

/** `${scenarioId}|${apiRoute}` — merged 실측 키와 동일. */
export function measuredScenarioRouteKey(scenarioId: string, apiRoute: string): string {
  return `${scenarioId}|${apiRoute}`;
}

/**
 * 선택된 시나리오를 커버/미커버로 나눈다. 선택된 **모든** API 라우트에 실측이 있어야 커버.
 * `apiRoutes`가 비면 비교할 라우트가 없으므로 전부 미커버로 둔다(실행 계획이 비는 것과 같게).
 */
export function splitCoveredScenarioIds(
  selectedScenarioIds: readonly string[],
  apiRoutes: readonly string[],
  measuredKeys: ReadonlySet<string>,
): { missing: string[]; covered: string[] } {
  const missing: string[] = [];
  const covered: string[] = [];
  if (apiRoutes.length === 0) {
    return { missing: [...selectedScenarioIds], covered: [] };
  }
  for (const id of selectedScenarioIds) {
    const complete = apiRoutes.every((route) => measuredKeys.has(measuredScenarioRouteKey(id, route)));
    if (complete) covered.push(id);
    else missing.push(id);
  }
  return { missing, covered };
}

export function measuredKeysFromMerged(merged: {
  scenarios: Array<{ id: string; api_route: string; runs: unknown[] }>;
} | null): Set<string> {
  const keys = new Set<string>();
  if (!merged) return keys;
  for (const s of merged.scenarios) {
    if (!Array.isArray(s.runs) || s.runs.length === 0) continue;
    keys.add(measuredScenarioRouteKey(s.id, s.api_route));
  }
  return keys;
}

/**
 * 현재 워크로드 설정과 같은 실측 키.
 *
 * 저장 `config_id`는 불완전 메타에 `legacy_run_id`를 섞는다(unknown 프로필은 `profile_version`이
 * 없어 항상 불완전). 갭 채우기는 통계 격리와 달리 **설정 본문**이 같으면 같은 최신으로 본다 —
 * 그렇지 않으면 큐가 매번 프로파일을 붙이는 모델은 커버가 영원히 안 잡힌다.
 */
export function measuredKeysForCurrentSettings(
  db: DatabaseSync,
  modelId: string,
  baseUrl: string,
  provider: string,
  settingsCanonical: string,
): Set<string> {
  const runs = db
    .prepare(
      `SELECT run_id, meta_json FROM bench_runs
       WHERE model_id = ? AND base_url = ? AND provider = ?
         AND status IN ('ok', 'partial', 'cancelled') AND finished_at IS NOT NULL`,
    )
    .all(modelId, baseUrl, provider) as Array<{ run_id: string; meta_json: string }>;

  const matchingIds: string[] = [];
  for (const row of runs) {
    try {
      const meta = JSON.parse(row.meta_json) as Record<string, unknown>;
      if (benchSettingsCanonical(meta) === settingsCanonical) matchingIds.push(row.run_id);
    } catch {
      // 깨진 meta_json은 커버로 치지 않는다.
    }
  }
  if (matchingIds.length === 0) return new Set();

  const placeholders = matchingIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT scenario_id, api_route FROM bench_scenarios
       WHERE run_id IN (${placeholders})
         AND COALESCE(json_array_length(json_extract(aggregate_json, '$.runs')), 0) > 0`,
    )
    .all(...matchingIds) as Array<{ scenario_id: string; api_route: string }>;

  const keys = new Set<string>();
  for (const row of rows) keys.add(measuredScenarioRouteKey(row.scenario_id, row.api_route));
  return keys;
}

function unionScenarioIds(modelIds: readonly string[], byModel: Record<string, string[]>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const modelId of modelIds) {
    for (const id of byModel[modelId] ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** DB + 현재 요청으로 모델별 갭을 계산한다. 큐 잠금은 호출자가 담당한다. */
export function planGapFill(args: {
  db: DatabaseSync;
  detect: DetectResult;
  base: BenchQueueBaseRequest;
  intent: BenchProfileIntent;
  modelIds: string[];
}): GapFillPlan {
  const { db, detect, base, intent, modelIds } = args;
  const baseUrl = normBaseUrl(detect.baseUrl);
  const models: BenchGapPreviewModel[] = [];
  const scenarioIdsByModel: Record<string, string[]> = {};
  const runnableModelIds: string[] = [];

  for (const modelId of modelIds) {
    const req = benchRequestForQueueModel(base, modelId, intent);
    const meta = makeBenchRunMeta(req, detect, "plan");
    const { missing, covered } = splitCoveredScenarioIds(
      meta.scenario_ids,
      meta.api_routes,
      measuredKeysForCurrentSettings(
        db,
        modelId,
        baseUrl,
        req.provider,
        benchSettingsCanonical(meta),
      ),
    );
    models.push({
      model_id: modelId,
      missing_scenario_ids: missing,
      covered_scenario_ids: covered,
    });
    if (missing.length > 0) {
      scenarioIdsByModel[modelId] = missing;
      runnableModelIds.push(modelId);
    }
  }

  return {
    models,
    runnableModelIds,
    scenarioIdsByModel,
    unionScenarioIds: unionScenarioIds(runnableModelIds, scenarioIdsByModel),
  };
}
