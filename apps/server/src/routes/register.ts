import type { Hono } from "hono";
import { z } from "zod";
import type {
  BenchRunMeta,
  DetectResult,
  StreamEvent,
  LlmProfileFamily,
  SamplingPresetName,
  StressRunMeta,
  StressStreamEvent,
} from "@llm-bench/shared";
import {
  BenchStreamBodySchema,
  DetectBodySchema,
  StressStreamBodySchema,
  leakMetricsFromBenchDetails,
} from "@llm-bench/shared";
import { makeBenchRunMeta, runBench, type BenchRequest } from "../bench-runner.js";
import { detectProvider } from "../detect.js";
import { registerMonitorRoutes } from "../monitor-routes.js";
import { runStress, type StressRequest } from "../stress-runner.js";
import { registerCatalogRoutes } from "../catalog-routes.js";
import { buildOpenApiSpec } from "../openapi/build-spec.js";
import { renderDocsHtml } from "../openapi/docs-html.js";
import { SQLITE_PUBLIC_UNAVAILABLE_MSG, normBaseUrl } from "../http-shared.js";

const RunsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const STRESS_STATUS_VALUES = ["running", "ok", "partial", "error"] as const;
const emptyStressFilterOptions = () => ({
  workload_ids: [] as string[],
  statuses: [] as Array<(typeof STRESS_STATUS_VALUES)[number]>,
  model_ids: [] as string[],
  base_urls: [] as string[],
});

/**
 * 기존 벤치·스트레스·런·detect·monitor·카탈로그 라우트를 한 prefix 아래 등록한다.
 * `/api`(웹 UI 호환)와 `/api/v1`(문서화된 안정 표면) 두 번 호출된다 — 핸들러 바디는 동일.
 * 핸들러는 `c.req.param()/query()`만 쓰므로 경로 문자열만 prefix로 템플릿한다(로직 무변경).
 */
export function registerApiRoutes(app: Hono, prefix: string): void {
  app.get(`${prefix}/health`, (c) => c.json({ ok: true, service: "llm-bench-server" }));

  // (model_id, base_url)별 최신 finished 런 요약 — 통계 페이지 목록
  app.get(`${prefix}/stats/model-latest`, async (c) => {
    try {
      const dbMod = await import("../db/database.js");
      const db = dbMod.tryOpenProdBenchDatabase();
      if (!db) {
        return c.json({
          items: [],
          sqlite_available: false,
          sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG,
        });
      }
      const runQueries = await import("../db/run-queries.js");
      const raw = dbMod.listLatestFinishedRunSummaries(db);
      const items = raw.map((r) => {
        // #80: 측정 시나리오가 있는 런만 상세를 읽어 모델 × 라우트 누수/정체 지표를 붙인다.
        let leaks: ReturnType<typeof leakMetricsFromBenchDetails> = [];
        if (r.scenario_count > 0) {
          const detail = runQueries.benchResultDetailFromDb(db, r.run_id);
          if (detail) leaks = leakMetricsFromBenchDetails([detail]);
        }
        return {
          run_id: r.run_id,
          model_id: r.model_id,
          base_url: normBaseUrl(r.base_url),
          provider: r.provider,
          finished_at: r.finished_at,
          created_at: r.created_at,
          status: r.status,
          scenario_count: r.scenario_count,
          leaks,
        };
      });
      return c.json({ items, sqlite_available: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[llm-bench-server] /api/stats/model-latest DB 로드 실패:", msg);
      return c.json({ items: [], sqlite_available: false, sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG });
    }
  });

  app.get(`${prefix}/runs/latest-by-model`, async (c) => {
    const q = z
      .object({
        baseUrl: z.string().min(1),
        modelIds: z.string().min(1),
      })
      .safeParse({ baseUrl: c.req.query("baseUrl"), modelIds: c.req.query("modelIds") });
    if (!q.success) return c.json({ error: q.error.flatten() }, 400);
    const ids = q.data.modelIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) return c.json({ error: "modelIds required" }, 400);
    const norm = normBaseUrl(q.data.baseUrl);
    try {
      const dbMod = await import("../db/database.js");
      const runQueries = await import("../db/run-queries.js");
      const db = dbMod.tryOpenProdBenchDatabase();
      if (!db) {
        return c.json({
          base_url: norm,
          items: ids.map((model_id) => ({ model_id, run: null as null })),
          sqlite_available: false,
          sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG,
        });
      }
      const map = dbMod.latestFinishedRunsByModels(db, norm, ids);
      const items = ids.map((model_id) => {
        const row = map.get(model_id);
        if (!row) return { model_id, run: null as null };
        const run = runQueries.benchResultDetailFromDb(db, row.run_id);
        return { model_id, run };
      });
      return c.json({ base_url: norm, items, sqlite_available: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[llm-bench-server] /api/runs/latest-by-model DB 로드 실패:", msg);
      return c.json({
        base_url: norm,
        items: ids.map((model_id) => ({ model_id, run: null as null })),
        sqlite_available: false,
        sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG,
      });
    }
  });

  app.get(`${prefix}/runs`, async (c) => {
    const parsed = RunsQuery.safeParse({ limit: c.req.query("limit") });
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    try {
      const dbMod = await import("../db/database.js");
      const db = dbMod.tryOpenProdBenchDatabase();
      if (!db) {
        return c.json({
          runs: [],
          sqlite_available: false,
          sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG,
        });
      }
      const rows = dbMod.listRecentRuns(db, parsed.data.limit);
      return c.json({ runs: rows, sqlite_available: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[llm-bench-server] /api/runs DB 로드 실패:", msg);
      return c.json({ runs: [], sqlite_available: false, sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG });
    }
  });

  app.get(`${prefix}/runs/:runId`, async (c) => {
    const runId = c.req.param("runId");
    if (runId === "latest-by-model") return c.json({ error: "not_found" }, 404);
    try {
      const dbMod = await import("../db/database.js");
      const runQueries = await import("../db/run-queries.js");
      const db = dbMod.tryOpenProdBenchDatabase();
      if (!db) {
        return c.json(
          {
            error: "sqlite_unavailable",
            message: SQLITE_PUBLIC_UNAVAILABLE_MSG,
          },
          503,
        );
      }
      const detail = runQueries.benchResultDetailFromDb(db, runId);
      if (!detail) return c.json({ error: "not_found" }, 404);
      return c.json(detail);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[llm-bench-server] /api/runs/:runId DB 로드 실패:", msg);
      return c.json({ error: "sqlite_load_failed", message: SQLITE_PUBLIC_UNAVAILABLE_MSG }, 503);
    }
  });

  app.get(`${prefix}/stress/runs`, async (c) => {
    const q = c.req.query();
    if (q.before && !q.before_id) {
      return c.json({ error: "before_id required when before is set" }, 400);
    }
    if (q.status && !(STRESS_STATUS_VALUES as readonly string[]).includes(q.status)) {
      return c.json({ error: `invalid status: ${q.status}` }, 400);
    }
    const limit = Math.min(Math.max(parseInt(q.limit ?? "50", 10) || 50, 1), 200);
    try {
      const dbMod = await import("../db/database.js");
      const db = dbMod.tryOpenProdBenchDatabase();
      if (!db) {
        return c.json({
          items: [],
          filter_options: emptyStressFilterOptions(),
          has_more: false,
          sqlite_available: false,
          sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG,
        });
      }
      const rows = dbMod.listStressRunsFiltered(db, {
        workload_id: q.workload_id,
        status: q.status,
        model_id: q.model_id,
        base_url: q.base_url,
        before_created_at: q.before,
        before_run_id: q.before_id,
        limit: limit + 1,
      });
      const has_more = rows.length > limit;
      if (has_more) rows.pop();
      const items = rows.map((r) => ({ ...r, base_url: normBaseUrl(r.base_url) }));
      const fo = dbMod.getStressFilterOptions(db);
      const filter_options = {
        workload_ids: fo.workload_ids,
        statuses: fo.statuses.filter((s): s is (typeof STRESS_STATUS_VALUES)[number] =>
          (STRESS_STATUS_VALUES as readonly string[]).includes(s),
        ),
        model_ids: fo.model_ids,
        base_urls: Array.from(new Set(fo.base_urls.map(normBaseUrl))).sort(),
      };
      return c.json({ items, filter_options, has_more, sqlite_available: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[llm-bench-server] /api/stress/runs DB 로드 실패:", msg);
      return c.json({
        items: [],
        filter_options: emptyStressFilterOptions(),
        has_more: false,
        sqlite_available: false,
        sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG,
      });
    }
  });

  app.get(`${prefix}/stress/runs/:runId`, async (c) => {
    const runId = c.req.param("runId");
    try {
      const dbMod = await import("../db/database.js");
      const db = dbMod.tryOpenProdBenchDatabase();
      if (!db) {
        return c.json(
          {
            error: "sqlite_unavailable",
            message: SQLITE_PUBLIC_UNAVAILABLE_MSG,
          },
          503,
        );
      }
      const meta = dbMod.getStressRunMeta(db, runId);
      if (!meta) return c.json({ error: "not_found" }, 404);
      let metaJson: Record<string, unknown> = {};
      try {
        metaJson = JSON.parse(meta.meta_json);
      } catch (err) {
        console.warn("[llm-bench-server] stress meta_json parse failed", meta.run_id, err);
      }
      const stageRows = dbMod.listStressStages(db, runId);
      const stages = stageRows.flatMap((s) => {
        try {
          const parsed = JSON.parse(s.result_json);
          return [{ stage_index: s.stage_index, concurrency: s.concurrency, ...parsed }];
        } catch (err) {
          console.warn(
            "[llm-bench-server] stress stage result_json parse failed",
            meta.run_id,
            s.stage_index,
            err,
          );
          return [];
        }
      });
      return c.json({
        meta: {
          ...metaJson,
          run_id: meta.run_id,
          created_at: meta.created_at,
          base_url: normBaseUrl(meta.base_url),
          provider: meta.provider,
          model_id: meta.model_id,
          workload_id: meta.workload_id,
          status: meta.status,
          finished_at: meta.finished_at,
          error_code: meta.error_code,
          error_message: meta.error_message,
        },
        stages,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[llm-bench-server] /api/stress/runs/:runId DB 로드 실패:", msg);
      return c.json({ error: "internal_error", message: SQLITE_PUBLIC_UNAVAILABLE_MSG }, 500);
    }
  });

  app.delete(`${prefix}/stress/runs/:runId`, async (c) => {
    const runId = c.req.param("runId");
    try {
      const dbMod = await import("../db/database.js");
      const db = dbMod.tryOpenProdBenchDatabase();
      if (!db) {
        return c.json(
          { error: "sqlite_unavailable", message: SQLITE_PUBLIC_UNAVAILABLE_MSG },
          503,
        );
      }
      const changes = dbMod.deleteStressRun(db, runId);
      if (changes === 0) return c.json({ error: "not_found" }, 404);
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[llm-bench-server] DELETE /api/stress/runs/:runId 실패:", msg);
      return c.json({ error: "internal_error", message: SQLITE_PUBLIC_UNAVAILABLE_MSG }, 500);
    }
  });

  app.post(`${prefix}/detect`, async (c) => {
    const body = DetectBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.flatten() }, 400);
    const { baseUrl, apiKey, manual } = body.data;
    try {
      const result = await detectProvider(baseUrl, { apiKey, manual });
      return c.json(result satisfies DetectResult);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  });

  app.post(`${prefix}/bench/stream`, async (c) => {
    const parsed = BenchStreamBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { detect, bench } = parsed.data;

    const req: BenchRequest = {
      baseUrl: bench.baseUrl,
      apiKey: bench.apiKey,
      provider: bench.provider,
      modelId: bench.modelId,
      scenarioIds: bench.scenarioIds as BenchRequest["scenarioIds"],
      temperature: bench.temperature,
      max_tokens: bench.max_tokens,
      requestTimeoutMs: bench.requestTimeoutMs,
      warmupRuns: bench.warmupRuns,
      measuredRuns: bench.measuredRuns,
      skipModelLoad: bench.skipModelLoad,
      unloadOtherModels: bench.unloadOtherModels,
      autoUnloadAfterBench: bench.autoUnloadAfterBench,
      publicAssetsOrigin: bench.publicAssetsOrigin,
      profileMaxTokens: bench.profileMaxTokens,
      apiRoutes: bench.apiRoutes,
      contentionGuardEnabled: bench.contentionGuardEnabled,
      contentionPollIntervalMs: bench.contentionPollIntervalMs,
      contentionMaxRetriesPerIteration: bench.contentionMaxRetriesPerIteration,
      contentionPreBenchTimeoutMs: bench.contentionPreBenchTimeoutMs,
      contentionBetweenIterationTimeoutMs: bench.contentionBetweenIterationTimeoutMs,
      contentionTotalWaitBudgetMs: bench.contentionTotalWaitBudgetMs,
      contentionGpuUtilThresholdPct: bench.contentionGpuUtilThresholdPct,
      contentionRequiredConsecutiveIdle: bench.contentionRequiredConsecutiveIdle,
      contentionServerMetricsEnabled: bench.contentionServerMetricsEnabled,
      contentionLmsCliActivityEnabled: bench.contentionLmsCliActivityEnabled,
      profile: {
        profileId: bench.profileId as LlmProfileFamily | "auto" | undefined,
        taskMode: bench.taskMode,
        thinkingIntent: bench.thinkingIntent,
        preserveThinking: bench.preserveThinking,
        presetOverride: bench.presetOverride as SamplingPresetName | undefined,
        samplingOverrides: bench.samplingOverrides,
        reasoningEffort: bench.reasoningEffort,
      },
    };

    type Persister = { start(meta: BenchRunMeta): void; onEvent(ev: StreamEvent): void; finalize(): void };
    const noopPersister: Persister = {
      start() {},
      onEvent() {},
      finalize() {},
    };

    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        const push = (ev: StreamEvent) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        let persister: Persister = noopPersister;
        try {
          const dbMod = await import("../db/database.js");
          const { BenchRunPersistence } = await import("../db/persist-stream.js");
          persister = new BenchRunPersistence(dbMod.tryOpenProdBenchDatabase());
        } catch (e) {
          console.error("[llm-bench-server] SQLite 계층 로드 실패 — 벤치는 진행하나 디스크 저장은 건너뜁니다:", e);
          persister = noopPersister;
        }
        let started = false;
        try {
          for await (const ev of runBench(req, detect)) {
            if (ev.type === "run_started") {
              const meta: BenchRunMeta = ev.meta ?? makeBenchRunMeta(req, detect, ev.run_id);
              persister.start(meta);
              started = true;
            }
            persister.onEvent(ev);
            push(ev);
          }
        } catch (e) {
          push({
            type: "error",
            layer: "orchestrator",
            code: "stream_failed",
            message: String(e),
          });
        } finally {
          if (started) persister.finalize();
          controller.close();
        }
      },
    });

    return c.newResponse(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  app.post(`${prefix}/stress/stream`, async (c) => {
    const parsed = StressStreamBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { detect, stress } = parsed.data;

    const req: StressRequest = {
      baseUrl: stress.baseUrl,
      apiKey: stress.apiKey,
      provider: stress.provider,
      modelId: stress.modelId,
      workloadId: stress.workloadId,
      ramp: stress.ramp,
      maxTokens: stress.maxTokens,
      temperature: stress.temperature,
      workerPromptSuffix: stress.workerPromptSuffix,
      requestTimeoutMs: stress.requestTimeoutMs,
      skipModelLoad: stress.skipModelLoad,
      unloadOtherModels: stress.unloadOtherModels,
      autoUnloadAfterBench: stress.autoUnloadAfterBench,
      profile: {
        profileId: stress.profileId as LlmProfileFamily | "auto" | undefined,
        taskMode: stress.taskMode,
        thinkingIntent: stress.thinkingIntent,
        preserveThinking: stress.preserveThinking,
        presetOverride: stress.presetOverride as SamplingPresetName | undefined,
        samplingOverrides: stress.samplingOverrides,
        reasoningEffort: stress.reasoningEffort,
      },
    };

    type StressPersister = {
      start(meta: StressRunMeta): void;
      onEvent(ev: StressStreamEvent): void;
      finalize(): void;
    };
    const noopPersister: StressPersister = { start() {}, onEvent() {}, finalize() {} };

    const encoder = new TextEncoder();
    const externalAbort = new AbortController();
    c.req.raw.signal.addEventListener("abort", () => externalAbort.abort());

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        const push = (ev: StressStreamEvent) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        let persister: StressPersister = noopPersister;
        try {
          const dbMod = await import("../db/database.js");
          const { StressRunPersistence } = await import("../db/stress-persist-stream.js");
          persister = new StressRunPersistence(dbMod.tryOpenProdBenchDatabase());
        } catch (e) {
          console.error(
            "[llm-bench-server] SQLite 계층 로드 실패 — 프로바이더 벤치는 진행하나 디스크 저장은 건너뜁니다:",
            e,
          );
          persister = noopPersister;
        }
        let started = false;
        try {
          for await (const ev of runStress(req, detect, { signal: externalAbort.signal })) {
            if (ev.type === "run_started") {
              persister.start(ev.meta);
              started = true;
            }
            persister.onEvent(ev);
            push(ev);
          }
        } catch (e) {
          push({ type: "error", code: "stream_failed", message: String(e) });
        } finally {
          if (started) persister.finalize();
          controller.close();
        }
      },
      cancel() {
        externalAbort.abort();
      },
    });

    return c.newResponse(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  // OpenAPI 3.1 스펙 + 자립형 문서 UI(오프라인). 정적 SPA 폴백보다 먼저 등록되므로 안전.
  app.get(`${prefix}/openapi.json`, (c) => c.json(buildOpenApiSpec()));
  app.get(`${prefix}/docs`, (c) => {
    c.header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
    return c.html(renderDocsHtml(prefix));
  });

  // 에이전트 대상 카탈로그·스코어보드(gap 메우기) + 모니터 라우트를 같은 prefix에 마운트.
  registerCatalogRoutes(app, prefix);
  registerMonitorRoutes(app, prefix);
}
