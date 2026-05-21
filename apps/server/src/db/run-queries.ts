import type { BenchResult, BenchRunMeta } from "@llm-bench/shared";
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
  return { meta, scenarios };
}

export type ScenarioDetail = BenchResult["scenarios"][number] & {
  prompt_preview: string | null;
  prompt_system_preview: string | null;
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
