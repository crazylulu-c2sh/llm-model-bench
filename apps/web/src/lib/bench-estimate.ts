import { cleanModelDisplayName, isVisionScenario, parseModelQuant } from "@llm-bench/shared";
import type { BenchRunDetailResponse, LatestByModelResponse } from "../api-types";

export type ScenarioTimeStat = { avgMs: number; iterMultiplier: number };
export type BaseModelTimeStat = ScenarioTimeStat & { sourceModelIds: string[] };

export type FallbackUnit = { scenarioId: string; apiRoute: string; quant: string | null };

export type ModelEtaEstimate = {
  ms: number;
  covered: number;
  total: number;
  usedFallbackFor: FallbackUnit[];
};

function scenarioKey(modelId: string, scenarioId: string, apiRoute: string): string {
  return `${modelId}::${scenarioId}::${apiRoute}`;
}

/**
 * 시나리오 1건의 반복 횟수(=warmup+measured, 비전은 워밍업 스킵). 과거 데이터 집계(statsFromRun)와
 * 라이브 ETA(App.tsx의 benchEta) 양쪽이 같은 규칙을 써야 하므로 이 한 곳에서만 정의한다.
 */
export function defaultIterMultiplier(scenarioId: string, warmupRuns: number, measuredRuns: number): number {
  return isVisionScenario(scenarioId) ? measuredRuns : warmupRuns + measuredRuns;
}

type RunScenarioStat = { scenarioId: string; apiRoute: string; avgMs: number; iterMultiplier: number };

function statsFromRun(run: BenchRunDetailResponse): RunScenarioStat[] {
  const meta = run.meta as { warmup_runs?: unknown; measured_runs?: unknown };
  const warmupRuns = typeof meta.warmup_runs === "number" ? meta.warmup_runs : 1;
  const measuredRuns = typeof meta.measured_runs === "number" ? meta.measured_runs : 3;
  const out: RunScenarioStat[] = [];
  for (const sc of run.scenarios ?? []) {
    const totals = (sc.runs ?? [])
      .map((r) => r.total_ms)
      .filter((ms): ms is number => typeof ms === "number" && ms > 0);
    if (totals.length === 0) continue;
    const avgMs = totals.reduce((a, b) => a + b, 0) / totals.length;
    const iterMultiplier = defaultIterMultiplier(sc.id, warmupRuns, measuredRuns);
    out.push({ scenarioId: sc.id, apiRoute: sc.api_route, avgMs, iterMultiplier });
  }
  return out;
}

/** 정확 일치용 1차 인덱스: model_id::scenario::api → 최근 실행의 평균 소요 시간. */
export function buildScenarioTimeIndex(latest: LatestByModelResponse | null): Map<string, ScenarioTimeStat> {
  const idx = new Map<string, ScenarioTimeStat>();
  if (!latest) return idx;
  for (const item of latest.items) {
    if (!item.run) continue;
    for (const s of statsFromRun(item.run)) {
      idx.set(scenarioKey(item.model_id, s.scenarioId, s.apiRoute), {
        avgMs: s.avgMs,
        iterMultiplier: s.iterMultiplier,
      });
    }
  }
  return idx;
}

/**
 * 양자화-폴백용 2차 인덱스: cleanModelDisplayName(model_id)::scenario::api → 같은 베이스 모델의
 * (다른 양자화를 포함한) 여러 model_id 평균. 정확 일치 기록이 없을 때만 참조한다.
 */
export function buildBaseModelTimeIndex(latest: LatestByModelResponse | null): Map<string, BaseModelTimeStat> {
  const groups = new Map<
    string,
    { sumMs: number; n: number; iterMultiplier: number; sourceModelIds: Set<string> }
  >();
  if (latest) {
    for (const item of latest.items) {
      if (!item.run) continue;
      const base = cleanModelDisplayName(item.model_id);
      for (const s of statsFromRun(item.run)) {
        const key = scenarioKey(base, s.scenarioId, s.apiRoute);
        const g = groups.get(key) ?? {
          sumMs: 0,
          n: 0,
          iterMultiplier: s.iterMultiplier,
          sourceModelIds: new Set<string>(),
        };
        g.sumMs += s.avgMs;
        g.n += 1;
        g.sourceModelIds.add(item.model_id);
        groups.set(key, g);
      }
    }
  }
  const idx = new Map<string, BaseModelTimeStat>();
  for (const [key, g] of groups) {
    idx.set(key, { avgMs: g.sumMs / g.n, iterMultiplier: g.iterMultiplier, sourceModelIds: [...g.sourceModelIds] });
  }
  return idx;
}

export type ResolvedScenarioUnit = {
  avgMs: number;
  iterMultiplier: number;
  /** true면 정확 일치가 아니라 같은 베이스 모델의 다른 양자화 기록을 근거로 썼다는 뜻. */
  isFallback: boolean;
  /** 폴백 근거가 된 모델의 양자화 태그(파싱 불가하면 null). isFallback이 false면 항상 null. */
  fallbackQuant: string | null;
};

/**
 * 한 (model, scenario, api) 단위의 과거 평균 소요 시간을 정확 일치 → 같은 베이스 모델의
 * 다른 양자화 폴백 순으로 조회한다. 둘 다 없으면 null(=이 단위에 대한 과거 데이터 전무).
 * 라이브 ETA 블렌딩(blendUnitMs)과 사전 예상 합산(estimateModelMs)이 공유하는 단일 조회 지점.
 */
export function resolveScenarioUnit(
  modelId: string,
  scenarioId: string,
  apiRoute: string,
  exactIndex: Map<string, ScenarioTimeStat>,
  baseIndex: Map<string, BaseModelTimeStat>,
): ResolvedScenarioUnit | null {
  const exact = exactIndex.get(scenarioKey(modelId, scenarioId, apiRoute));
  if (exact) {
    return { avgMs: exact.avgMs, iterMultiplier: exact.iterMultiplier, isFallback: false, fallbackQuant: null };
  }
  const baseName = cleanModelDisplayName(modelId);
  const fallback = baseIndex.get(scenarioKey(baseName, scenarioId, apiRoute));
  if (!fallback) return null;
  const fallbackModelId = fallback.sourceModelIds.find((id) => id !== modelId) ?? fallback.sourceModelIds[0];
  return {
    avgMs: fallback.avgMs,
    iterMultiplier: fallback.iterMultiplier,
    isFallback: true,
    fallbackQuant: fallbackModelId ? parseModelQuant(fallbackModelId) : null,
  };
}

/**
 * 선택된 시나리오·라우트 조합에 대해 모델의 예상 소요 시간을 계산한다.
 * 정확 일치 → 같은 베이스 모델의 다른 양자화 폴백 → 그래도 없으면 미커버 순으로 조회하고,
 * 일부만 커버되면 커버된 단위의 평균으로 나머지를 보충한다. 전혀 커버되지 않으면 null(=숨김).
 */
export function estimateModelMs(
  modelId: string,
  scenarioIds: readonly string[],
  apiRoutes: readonly string[],
  exactIndex: Map<string, ScenarioTimeStat>,
  baseIndex: Map<string, BaseModelTimeStat>,
): ModelEtaEstimate | null {
  const total = scenarioIds.length * apiRoutes.length;
  if (total === 0) return null;
  const usedFallbackFor: FallbackUnit[] = [];
  let coveredSum = 0;
  let coveredCount = 0;
  let uncoveredCount = 0;
  for (const scenarioId of scenarioIds) {
    for (const apiRoute of apiRoutes) {
      const resolved = resolveScenarioUnit(modelId, scenarioId, apiRoute, exactIndex, baseIndex);
      if (!resolved) {
        uncoveredCount += 1;
        continue;
      }
      coveredSum += resolved.avgMs * resolved.iterMultiplier;
      coveredCount += 1;
      if (resolved.isFallback) {
        usedFallbackFor.push({ scenarioId, apiRoute, quant: resolved.fallbackQuant });
      }
    }
  }
  if (coveredCount === 0) return null;
  const meanPerUnitMs = coveredSum / coveredCount;
  const ms = coveredSum + meanPerUnitMs * uncoveredCount;
  return { ms, covered: coveredCount, total, usedFallbackFor };
}

/**
 * 과거 평균(historicalAvgMs)과 이번 런에서 관측된 값들을 K로 수렴 가중 평균한다.
 * 과거 데이터가 없으면 관측치가 하나라도 쌓이기 전까지 null(=알 수 없음 — 추정치를 지어내지 않음).
 */
export function blendUnitMs(
  historicalAvgMs: number | null,
  observedSum: number,
  observedCount: number,
  k = 3,
): number | null {
  if (observedCount === 0) return historicalAvgMs;
  if (historicalAvgMs == null) return observedSum / observedCount;
  return (historicalAvgMs * k + observedSum) / (k + observedCount);
}
