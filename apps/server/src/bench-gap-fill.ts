import type { BenchGapPreviewModel, BenchProfileIntent, DetectResult } from "@llm-bench/shared";
import { benchConfig } from "./bench-config.js";
import { makeBenchRunMeta } from "./bench-runner.js";
import {
  benchRequestForQueueModel,
  type BenchQueueBaseRequest,
} from "./bench-queue-runner.js";
import { mergedBenchDetailFromDb } from "./db/run-queries.js";
import { normBaseUrl } from "./http-shared.js";
import type { DatabaseSync } from "node:sqlite";

/**
 * 현재 벤치 설정(`config_id`)으로 아직 실측이 없는 시나리오만 골라 큐에 넣는 갭 채우기.
 *
 * 통계·스코어보드 병합과 같은 그룹을 쓴다: (model_id, base_url, provider, config_id).
 * 시나리오 선택·반복 횟수는 config_id에 들어가지 않으므로, 후보 집합은 요청의 scenarioIds다.
 * 현재 설정이 불완전하면 커버로 치지 않고 선택 시나리오를 전부 다시 돈다.
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
    const cfg = benchConfig(meta, meta.run_id);
    const measured = cfg.config_complete
      ? measuredKeysFromMerged(
          mergedBenchDetailFromDb(db, modelId, baseUrl, {
            config_id: cfg.config_id,
            provider: req.provider,
          }),
        )
      : new Set<string>();
    const { missing, covered } = splitCoveredScenarioIds(meta.scenario_ids, meta.api_routes, measured);
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
