import { benchConfig } from "../bench-config.js";
import { ALL_SCENARIO_IDS, type BenchResult, type BenchRunMeta } from "@llm-bench/shared";
import type { DatabaseSync } from "node:sqlite";
import { getRunMetaJson, listScenariosForRun } from "./database.js";

function parseAggregateRuns(aggregateJson: string): unknown[] {
  try {
    const o = JSON.parse(aggregateJson) as { runs?: unknown[] };
    return Array.isArray(o.runs) ? o.runs : [];
  } catch {
    return [];
  }
}

export function benchResultFromDb(db: DatabaseSync, run_id: string): BenchResult | null {
  const metaJson = getRunMetaJson(db, run_id);
  if (!metaJson) return null;
  let meta: BenchRunMeta;
  try {
    meta = JSON.parse(metaJson) as BenchRunMeta;
  } catch {
    return null;
  }
  const scenRows = listScenariosForRun(db, run_id);
  const scenarios = scenRows.map((s) => ({
    id: s.scenario_id,
    api_route: s.api_route as "chat_completions" | "messages",
    runs: parseAggregateRuns(s.aggregate_json) as BenchResult["scenarios"][number]["runs"],
  }));
  return { meta: { ...meta, ...benchConfig(meta, run_id) }, scenarios };
}

export type ScenarioDetail = BenchResult["scenarios"][number] & {
  prompt_preview: string | null;
  prompt_system_preview: string | null;
  /** 시나리오별 최신 병합 시 이 행이 온 finished 런 id. 스냅샷 상세에는 없음. */
  source_run_id?: string;
};

export type BenchResultDetail = {
  meta: BenchRunMeta;
  scenarios: ScenarioDetail[];
};

export function benchResultDetailFromDb(db: DatabaseSync, run_id: string): BenchResultDetail | null {
  const base = benchResultFromDb(db, run_id);
  if (!base) return null;
  const scenRows = listScenariosForRun(db, run_id);
  const promptByKey = new Map<string, string | null>();
  const systemPromptByKey = new Map<string, string | null>();
  for (const r of scenRows) {
    promptByKey.set(`${r.scenario_id}|${r.api_route}`, r.prompt_preview);
    systemPromptByKey.set(`${r.scenario_id}|${r.api_route}`, r.prompt_system_preview);
  }
  const scenarios = base.scenarios.map((s) => ({
    ...s,
    prompt_preview: promptByKey.get(`${s.id}|${s.api_route}`) ?? null,
    prompt_system_preview:
      systemPromptByKey.get(`${s.id}|${s.api_route}`) ?? null,
  }));
  return { meta: base.meta, scenarios };
}

type MeasuredScenarioJoinRow = {
  run_id: string;
  scenario_id: string;
  api_route: string;
  aggregate_json: string;
  prompt_preview: string | null;
  prompt_system_preview: string | null;
};

const SCENARIO_ORDER_INDEX = new Map(ALL_SCENARIO_IDS.map((id, i) => [id, i]));

function compareMergedScenarioIds(a: string, b: string): number {
  const ia = SCENARIO_ORDER_INDEX.get(a as (typeof ALL_SCENARIO_IDS)[number]);
  const ib = SCENARIO_ORDER_INDEX.get(b as (typeof ALL_SCENARIO_IDS)[number]);
  const na = ia ?? ALL_SCENARIO_IDS.length;
  const nb = ib ?? ALL_SCENARIO_IDS.length;
  return na - nb || a.localeCompare(b);
}

/**
 * (model_id, base_url)에 대해 시나리오×라우트별 가장 최근 실측을 모아 하나의 프로필로 반환.
 * meta는 최신 finished 런을 앵커로 두고, scenario_ids는 병합 집합(ALL_SCENARIO_IDS 순).
 * 빈 runs 행은 후보에서 제외해 측정 실패가 이전 실측을 지우지 않게 한다.
 */
export function mergedBenchDetailFromDb(
  db: DatabaseSync,
  modelId: string,
  baseUrl: string,
  group?: { config_id: string; provider: string },
): BenchResultDetail | null {
  const norm = baseUrl.replace(/\/+$/, "");
  const anchor = db
    .prepare(
      `SELECT run_id, meta_json, config_id, provider
       FROM bench_runs
       WHERE model_id = ? AND base_url = ?
         AND (? IS NULL OR (config_id = ? AND provider = ?))
         AND status IN ('ok', 'partial', 'cancelled') AND finished_at IS NOT NULL
       ORDER BY datetime(finished_at) DESC, datetime(created_at) DESC, rowid DESC
       LIMIT 1`,
    )
    .get(modelId, norm, group?.config_id ?? null, group?.config_id ?? null, group?.provider ?? null) as { run_id: string; meta_json: string; config_id: string; provider: string } | undefined;
  if (!anchor) return null;

  let meta: BenchRunMeta;
  try {
    meta = JSON.parse(anchor.meta_json) as BenchRunMeta;
  } catch {
    return null;
  }

  const rows = db
    .prepare(
      `SELECT s.run_id, s.scenario_id, s.api_route, s.aggregate_json,
              s.prompt_preview, s.prompt_system_preview
       FROM bench_scenarios s
       INNER JOIN bench_runs r ON r.run_id = s.run_id
       WHERE r.model_id = ? AND r.base_url = ? AND r.config_id = ? AND r.provider = ?
         AND r.status IN ('ok', 'partial', 'cancelled')
         AND r.finished_at IS NOT NULL
         AND COALESCE(json_array_length(json_extract(s.aggregate_json, '$.runs')), 0) > 0
       ORDER BY datetime(r.finished_at) DESC, datetime(r.created_at) DESC, r.rowid DESC,
                s.scenario_id, s.api_route`,
    )
    .all(modelId, norm, anchor.config_id, anchor.provider) as MeasuredScenarioJoinRow[];

  const seen = new Set<string>();
  const scenarios: ScenarioDetail[] = [];
  for (const row of rows) {
    const key = `${row.scenario_id}|${row.api_route}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scenarios.push({
      id: row.scenario_id,
      api_route: row.api_route as "chat_completions" | "messages",
      runs: parseAggregateRuns(row.aggregate_json) as BenchResult["scenarios"][number]["runs"],
      prompt_preview: row.prompt_preview,
      prompt_system_preview: row.prompt_system_preview,
      source_run_id: row.run_id,
    });
  }

  scenarios.sort((a, b) => {
    const byId = compareMergedScenarioIds(a.id, b.id);
    if (byId !== 0) return byId;
    return a.api_route.localeCompare(b.api_route);
  });

  const uniqueIds = [...new Set(scenarios.map((s) => s.id))];
  uniqueIds.sort(compareMergedScenarioIds);

  return {
    meta: {
      ...meta,
      ...benchConfig(meta, anchor.run_id),
      scenario_ids: uniqueIds,
    },
    scenarios,
  };
}

/** 앵커 run_id의 (model_id, base_url)로 시나리오별 최신 병합 프로필을 반환. */
export function mergedBenchDetailFromRunId(db: DatabaseSync, runId: string): BenchResultDetail | null {
  const row = db
    .prepare(`SELECT model_id, base_url, config_id, provider FROM bench_runs WHERE run_id = ?`)
    .get(runId) as { model_id: string; base_url: string; config_id: string; provider: string } | undefined;
  if (!row) return null;
  return mergedBenchDetailFromDb(db, row.model_id, row.base_url, row);
}
