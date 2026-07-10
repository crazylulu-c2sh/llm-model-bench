import type { Hono } from "hono";
import {
  ALL_SCENARIO_IDS,
  DEFAULT_SCENARIO_IDS,
  LLM_PROFILE_DEFINITIONS,
  PUBLIC_SCENARIO_IDS,
  STRESS_WORKLOAD_IDS,
  VISION_SCENARIO_IDS,
  buildScenarioCatalog,
  computeScoreboard,
  leakMetricsFromBenchDetails,
  scenarioIdsForTask,
  scoringRowsFromBenchDetails,
  type ScenarioId,
} from "@llm-bench/shared";
import { SQLITE_PUBLIC_UNAVAILABLE_MSG, normBaseUrl } from "./http-shared.js";

/** `set` 쿼리 → 시나리오 ID 목록. 기본은 PUBLIC. */
function idsForSet(set: string | undefined): readonly ScenarioId[] {
  switch (set) {
    case "default":
      return DEFAULT_SCENARIO_IDS;
    case "vision":
      return VISION_SCENARIO_IDS;
    case "all":
      return ALL_SCENARIO_IDS;
    case "public":
    default:
      return PUBLIC_SCENARIO_IDS;
  }
}

/**
 * 에이전트 대상 카탈로그·스코어보드 라우트. `/api`, `/api/v1` 두 prefix에 동일 핸들러로 마운트.
 * - `GET {prefix}/scenarios` : 시나리오 카탈로그(읽기 전용, DB 무관)
 * - `GET {prefix}/catalog`   : 시나리오 + 프로파일 + 스트레스 워크로드 한 번에
 * - `GET {prefix}/scoreboard`: 저장된 최신 런에서 서버 사이드 랭킹(품질·속도)
 */
export function registerCatalogRoutes(app: Hono, prefix: string): void {
  app.get(`${prefix}/scenarios`, (c) => {
    const set = c.req.query("set");
    return c.json({ scenarios: buildScenarioCatalog(idsForSet(set)) });
  });

  app.get(`${prefix}/catalog`, (c) => {
    return c.json({
      scenarios: buildScenarioCatalog(PUBLIC_SCENARIO_IDS),
      profiles: LLM_PROFILE_DEFINITIONS,
      stressWorkloads: STRESS_WORKLOAD_IDS,
    });
  });

  app.get(`${prefix}/scoreboard`, async (c) => {
    const baseUrl = c.req.query("baseUrl");
    if (!baseUrl || !baseUrl.trim()) {
      return c.json({ error: "baseUrl required" }, 400);
    }
    const norm = normBaseUrl(baseUrl.trim());
    const task = c.req.query("task") ?? undefined;
    const taskIds = scenarioIdsForTask(task);
    const filter = taskIds ? (id: string) => taskIds.has(id) : undefined;
    const filterInfo = {
      task,
      scenarios: taskIds ? Array.from(taskIds) : undefined,
    };
    const modelIdsRaw = c.req.query("modelIds");

    try {
      const dbMod = await import("./db/database.js");
      const runQueries = await import("./db/run-queries.js");
      const db = dbMod.tryOpenProdBenchDatabase();
      if (!db) {
        return c.json({
          base_url: norm,
          filter: filterInfo,
          rows: [],
          sqlite_available: false,
          sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG,
        });
      }

      // modelIds 지정 시 그대로, 아니면 이 baseUrl의 최신 finished 런이 있는 모든 모델.
      let ids: string[];
      if (modelIdsRaw && modelIdsRaw.trim()) {
        ids = modelIdsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        ids = dbMod
          .listLatestFinishedRunSummaries(db)
          .filter((r) => normBaseUrl(r.base_url) === norm)
          .map((r) => r.model_id);
      }
      if (ids.length === 0) {
        return c.json({ base_url: norm, filter: filterInfo, rows: [], leaks: [], sqlite_available: true });
      }

      const map = dbMod.latestFinishedRunsByModels(db, norm, ids);
      const details = ids
        .map((mid) => map.get(mid))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .map((row) => runQueries.benchResultDetailFromDb(db, row.run_id))
        .filter((d): d is NonNullable<typeof d> => Boolean(d));

      const board = computeScoreboard(scoringRowsFromBenchDetails(details, filter));
      const rows = board.map((row, i) => ({ rank: i + 1, ...row }));
      // #80: 모델 × 라우트 누수/정체 지표. 랭킹(rows)과 분리 — 같은 details를 재사용해 추가 DB 비용 없음.
      // task 필터와 무관하게 측정된 모든 시나리오로 집계(agent-safety는 모델·라우트 속성).
      const leaks = leakMetricsFromBenchDetails(details);
      // #81: 최신 런이 메모리-핏 skip이면 측정 런이 없어 rows에 안 나오므로, 조용히 사라지지 않게 별도 노출.
      const skipped = details
        .map((d) => {
          const pf = (d.meta as { preflight_memory_fit?: { action?: string; reason?: string } })
            .preflight_memory_fit;
          return pf?.action === "skip"
            ? { model_id: d.meta.model_id, reason: pf.reason ?? "won't fit" }
            : null;
        })
        .filter((x): x is { model_id: string; reason: string } => x != null);
      return c.json({
        base_url: norm,
        filter: filterInfo,
        rows,
        leaks,
        ...(skipped.length ? { skipped } : {}),
        sqlite_available: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[llm-bench-server] /api/scoreboard DB 로드 실패:", msg);
      return c.json({
        base_url: norm,
        filter: filterInfo,
        rows: [],
        sqlite_available: false,
        sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG,
      });
    }
  });
}
