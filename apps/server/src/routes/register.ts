import type { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type {
  BenchProfileIntent,
  BenchRunMeta,
  DetectResult,
  StreamEvent,
  LlmProfileFamily,
  SamplingPresetName,
  StressRunMeta,
  StressStreamEvent,
} from "@llm-bench/shared";
import {
  BaseUrlNameInputSchema,
  BenchQueueStartBodySchema,
  BenchStreamBodySchema,
  DetectBodySchema,
  StressStreamBodySchema,
  leakMetricsFromBenchDetails,
  parseModelPublisherFromId,
  scenarioCategory,
  type ScenarioCategory,
} from "@llm-bench/shared";
import { makeBenchRunMeta, runBench, type BenchRequest } from "../bench-runner.js";
import { runOneBenchModel } from "../bench-run-driver.js";
import {
  benchRequestForQueueModel,
  driveBenchQueue,
  type BenchQueueBaseRequest,
} from "../bench-queue-runner.js";
import {
  activeQueueForBaseUrl,
  createQueue,
  getQueueSnapshot,
  listQueues,
  pauseQueue,
  requestQueueStop,
  resumeQueue,
  subscribeToQueue,
} from "../bench-queue-registry.js";
import { describeFetchError, detectProvider } from "../detect.js";
import { readWindowsHostIp } from "../util/wsl-windows-host.js";
import { registerMonitorRoutes } from "../monitor-routes.js";
import { runStress, type StressRequest } from "../stress-runner.js";
import { cancelRunControl, pauseRunControl, resumeRunControl } from "../run-control.js";
import {
  endLiveRun,
  listLiveRuns,
  publishLiveEvent,
  startLiveRun,
  subscribeToLiveRun,
} from "../bench-live-registry.js";
import { registerCatalogRoutes } from "../catalog-routes.js";
import { buildOpenApiSpec } from "../openapi/build-spec.js";
import { renderDocsHtml } from "../openapi/docs-html.js";
import { SQLITE_PUBLIC_UNAVAILABLE_MSG, normBaseUrl } from "../http-shared.js";

const RunsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

type EventSubscription<E> = {
  bufferedEvents: E[];
  onEvent(cb: (ev: E) => void): void;
  onDone(cb: () => void): void;
  unsubscribe(): void;
};

/**
 * 진행 중인 런/큐에 재구독하는 SSE 응답 본문. 연결 즉시 버퍼링된 이벤트를 replay한 뒤
 * 라이브 이벤트를 계속 흘려보낸다 — 클라이언트가 최초 스트림과 **동일한 이벤트 처리 경로**로
 * 상태를 재구성할 수 있게(서버가 별도 "스냅샷" 포맷을 만들지 않는다).
 */
function sseStreamFromSubscription<E>(sub: EventSubscription<E>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const controllerBox: { ref: ReadableStreamDefaultController<Uint8Array> | null } = { ref: null };
  const push = (ev: E) => {
    if (!controllerBox.ref) return;
    try {
      controllerBox.ref.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
    } catch {
      controllerBox.ref = null;
    }
  };
  let keepalive: ReturnType<typeof setInterval> | null = null;
  /**
   * 정리는 **양쪽 종료 경로에서 모두** 불려야 한다. 소비자가 끊으면 `cancel()`이 오지만,
   * 런/큐가 정상 완주해 서버가 `close()`하는 경로에서는 `cancel()`이 오지 않는다
   * (Streams 스펙: 이미 closed면 source.cancel을 부르지 않는다). 여기서 정리하지 않으면
   * SSE 한 건마다 15초 인터벌과 emitter 리스너가 프로세스가 죽을 때까지 남는다.
   */
  const teardown = () => {
    if (keepalive) {
      clearInterval(keepalive);
      keepalive = null;
    }
    sub.unsubscribe();
    controllerBox.ref = null;
  };
  const onDone = () => {
    try {
      controllerBox.ref?.close();
    } catch {
      // 무시
    }
    teardown();
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerBox.ref = controller;
      for (const ev of sub.bufferedEvents) push(ev);
      sub.onEvent(push);
      sub.onDone(onDone);
      keepalive = setInterval(() => {
        if (!controllerBox.ref) return;
        try {
          controllerBox.ref.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          controllerBox.ref = null;
        }
      }, 15_000);
      keepalive.unref?.();
    },
    cancel: teardown,
  });
}

// 저장된 모델 카드 카테고리 칩 순서와 맞춘 고정 정렬.
const SCENARIO_CATEGORY_ORDER: readonly ScenarioCategory[] = ["text", "vision", "agent"];

/** group_concat된 측정 시나리오 id를 카테고리(text/vision/agent) 배열로 — 중복 제거·고정 순서. */
function categoriesFromMeasuredIds(joined: string | null): ScenarioCategory[] {
  if (!joined) return [];
  const present = new Set<ScenarioCategory>();
  for (const id of joined.split(",")) {
    if (id) present.add(scenarioCategory(id));
  }
  return SCENARIO_CATEGORY_ORDER.filter((c) => present.has(c));
}

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
  app.get(`${prefix}/health`, (c) =>
    c.json({
      ok: true,
      service: "llm-bench-server",
      wsl_windows_host: readWindowsHostIp(),
    }),
  );

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
          // 게시자(조직): 신규 런은 meta_json.publisher, 기존 런은 model_id의 org 접두 파생.
          publisher: r.publisher?.trim() || parseModelPublisherFromId(r.model_id) || undefined,
          base_url: normBaseUrl(r.base_url),
          provider: r.provider,
          finished_at: r.finished_at,
          created_at: r.created_at,
          status: r.status,
          scenario_count: r.scenario_count,
          // 측정 시나리오 id 접두에서 카테고리(text/vision/agent) 파생 — 저장된 모델 카드 필터용.
          categories: categoriesFromMeasuredIds(r.measured_scenario_ids),
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

  // Base URL 별칭(벤치 대상 시스템 이름): 목록 + upsert/clear.
  // 키는 trailing slash 제거된 정규화 base_url; 빈 이름 = 별칭 제거(원본 URL 사용).
  app.get(`${prefix}/base-url-names`, async (c) => {
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
      return c.json({ items: dbMod.listBaseUrlNames(db), sqlite_available: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[llm-bench-server] /api/base-url-names DB 로드 실패:", msg);
      return c.json({ items: [], sqlite_available: false, sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG });
    }
  });

  app.put(`${prefix}/base-url-names`, async (c) => {
    const parsed = BaseUrlNameInputSchema.safeParse(await c.req.json().catch(() => ({}) ));
    if (!parsed.success) {
      return c.json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
    }
    try {
      const dbMod = await import("../db/database.js");
      const db = dbMod.tryOpenProdBenchDatabase();
      if (!db) {
        return c.json(
          { ok: false, persisted: false, sqlite_available: false, sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG },
          503,
        );
      }
      const baseUrl = normBaseUrl(parsed.data.base_url);
      dbMod.upsertBaseUrlName(db, baseUrl, parsed.data.name || null, parsed.data.note ?? "");
      return c.json({
        ok: true,
        base_url: baseUrl,
        name: parsed.data.name.trim() || null,
        note: (parsed.data.note ?? "").trim() || undefined,
      });
    } catch (e) {
      // 쓰기 실패(SQLITE_BUSY·디스크 풀·읽기 전용 DB 등)도 다른 DB 라우트와 같은 형태로 응답한다.
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[llm-bench-server] /api/base-url-names 저장 실패:", msg);
      return c.json(
        { ok: false, persisted: false, sqlite_available: false, sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG },
        503,
      );
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
      const items = rows.map((r) => ({
        ...r,
        base_url: normBaseUrl(r.base_url),
        // 게시자(조직): 신규 런은 meta_json.publisher, 기존 런은 model_id의 org 접두 파생.
        publisher: r.publisher?.trim() || parseModelPublisherFromId(r.model_id) || undefined,
      }));
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
      return c.json({ error: describeFetchError(e) }, 500);
    }
  });

  app.post(`${prefix}/bench/stream`, async (c) => {
    const parsed = BenchStreamBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { detect, bench } = parsed.data;

    // 서버 소유 큐가 이 백엔드를 점유 중이면 단발 실행을 막는다 — 겹쳐 돌면 에러가 아니라
    // 조용한 측정 오염이 되고(원격 백엔드에서는 오염 가드 신호원이 없어 가드도 꺼진다),
    // AGENTS.md의 serial model execution 요구가 깨진다. 활성 *스트림* 런은 막지 않는다
    // (MCP의 타임아웃 후 재호출 흐름을 유지하기 위함).
    // 키는 bench.baseUrl이 아니라 **실제 추론 대상인 detect.baseUrl**이다 — runBench가 I/O에
    // 쓰는 값이 그쪽이라, 두 필드가 갈라지면 같은 백엔드에 락이 두 개 생긴다.
    const activeQueue = activeQueueForBaseUrl(normBaseUrl(detect.baseUrl));
    if (activeQueue) {
      return c.json(
        {
          error: "queue_active",
          message: "이 baseUrl에서 서버 벤치 큐가 실행 중입니다. 큐가 끝난 뒤 다시 시도하세요.",
          base_url: activeQueue.base_url,
          queue_id: activeQueue.queue_id,
          // 모델 경계·일시정지 상태에서는 실행 중인 모델이 없다 — 직전 모델을 현재로 보고하지 않는다.
          model_id: activeQueue.models.find((m) => m.status === "running")?.model_id ?? null,
        },
        409,
      );
    }

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
      loadTtlSeconds: bench.loadTtlSeconds,
      fitPolicy: bench.fitPolicy,
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

    const encoder = new TextEncoder();
    // 응답 스트림의 컨트롤러 — 클라이언트가 연결을 끊으면(새로고침 포함) `cancel()`로
    // ref가 null이 되어 이후 push()가 조용히 무시된다. 아래 실행 루프는 이 값과 완전히
    // 무관하게(별도 async 컨텍스트) 끝까지 진행되므로, 연결이 끊겨도 벤치는 죽지 않는다.
    // (객체 래퍼: bare `let`을 async IIFE 안에서 읽으면 이 TypeScript 버전에서 타입이
    // `never`로 잘못 좁혀지는 문제가 있어, 재할당 가능한 상태를 프로퍼티로 감싼다.)
    const controllerBox: { ref: ReadableStreamDefaultController<Uint8Array> | null } = { ref: null };
    const push = (ev: StreamEvent) => {
      if (!controllerBox.ref) return;
      try {
        controllerBox.ref.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      } catch {
        controllerBox.ref = null;
      }
    };
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerBox.ref = controller;
      },
      cancel() {
        // 구독 해제만 한다 — 실행 루프는 계속 진행된다. 긴급 정지는
        // POST /bench/:runId/stop을 통해서만 가능하다(연결 종료는 정지가 아니다).
        controllerBox.ref = null;
      },
    });

    // 일시정지 중에는 수 분간 이벤트가 없을 수 있다 — 리버스 프록시/브라우저의 idle-read
    // 타임아웃으로 연결이 끊기지 않도록 SSE 주석 줄로 주기적 keepalive를 보낸다.
    // `:`로 시작하는 줄은 `consumeSseJsonLines`가 `data:` 줄만 파싱하므로 무시된다.
    const keepalive = setInterval(() => {
      if (!controllerBox.ref) return;
      try {
        controllerBox.ref.enqueue(encoder.encode(": ping\n\n"));
      } catch {
        controllerBox.ref = null;
      }
    }, 15_000);

    // 실행 루프를 별도 async 컨텍스트로 완전히 분리 — await 하지 않는다(fire-and-forget).
    // 응답 스트림(그리고 그것을 구독하는 브라우저 연결)의 생존 여부와 무관하게 끝까지
    // 실행된다 — persister.finalize()도 마찬가지.
    void runOneBenchModel({ req, detect, onEvent: push }).finally(() => {
      clearInterval(keepalive);
      try {
        controllerBox.ref?.close();
      } catch {
        // 이미 닫혔거나 클라이언트가 사라짐 — 무시
      }
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

  app.post(`${prefix}/bench/:runId/pause`, (c) => {
    const ok = pauseRunControl(c.req.param("runId"));
    return ok ? c.json({ ok: true }) : c.json({ ok: false, error: "not_found" }, 404);
  });

  app.post(`${prefix}/bench/:runId/resume`, (c) => {
    const ok = resumeRunControl(c.req.param("runId"));
    return ok ? c.json({ ok: true }) : c.json({ ok: false, error: "not_found" }, 404);
  });

  app.post(`${prefix}/bench/:runId/stop`, (c) => {
    const ok = cancelRunControl(c.req.param("runId"));
    return ok ? c.json({ ok: true }) : c.json({ ok: false, error: "not_found" }, 404);
  });

  // 새로고침 등으로 화면을 잃었을 때 "지금 진행 중인 벤치가 있는가"를 알아내기 위한 조회.
  // baseUrl 쿼리로 좁힐 수 있다(현재 연결된 provider와 같은 벤치만 재연결 대상으로 삼기 위함).
  // `queues`에는 TTL(30분) 안의 **완료 큐도** 포함된다 — 마지막 모델이 끝난 직후 새로고침한 탭도
  // 모델별 run_id 목록을 받아야 결과를 DB에서 복원할 수 있기 때문. 실행 중 큐가 항상 앞에 온다.
  app.get(`${prefix}/bench/running`, (c) => {
    const baseUrl = c.req.query("baseUrl");
    const norm = baseUrl ? normBaseUrl(baseUrl) : undefined;
    const all = listLiveRuns();
    const runs = norm ? all.filter((r) => r.base_url === norm) : all;
    return c.json({ runs, queues: listQueues(norm) });
  });

  // ── 서버 소유 모델 큐 ────────────────────────────────────────────────────
  // 여러 모델을 서버가 순차 실행한다. 클라이언트는 구독자일 뿐이라 새로고침하거나 탭을 닫아도
  // 큐가 끝까지 진행되고, 탭 두 개가 각자 큐를 몰아 같은 GPU에 벤치를 겹치는 일이 원천 차단된다.
  app.post(`${prefix}/bench/queue`, async (c) => {
    const parsed = BenchQueueStartBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { detect, bench, model_ids } = parsed.data;
    // 실제 추론 대상(detect.baseUrl)으로 잠근다 — bench.baseUrl은 runBench가 I/O에 쓰지 않는다.
    const baseUrl = normBaseUrl(detect.baseUrl);

    // 아래 블록에는 await가 없다 — 같은 tick에 도착한 두 요청이 모두 통과하지 않도록
    // 충돌 검사와 큐 등록이 원자적으로 일어나야 한다(Node 단일 스레드).
    const conflict = activeQueueForBaseUrl(baseUrl);
    if (conflict) return c.json({ error: "queue_active", queue: conflict }, 409);
    // 큐 시작은 baseUrl이 **완전히 비었을 때만** 허용한다. 큐끼리만 배타적으로 두면
    // 단발 런(MCP·PR-B 이전 웹) 위로 큐가 그대로 올라타 같은 GPU에서 벤치 두 건이 겹친다.
    // 이건 에러가 아니라 조용한 측정 오염이라 실행 전에 막아야 한다.
    const busyRun = listLiveRuns().find((r) => r.base_url === baseUrl && !r.queue_id);
    if (busyRun) {
      return c.json(
        {
          error: "run_active",
          message: "이 baseUrl에서 단발 벤치 런이 실행 중입니다. 끝난 뒤 큐를 시작하세요.",
          base_url: busyRun.base_url,
          run_id: busyRun.run_id,
          model_id: busyRun.model_id,
        },
        409,
      );
    }

    const base: BenchQueueBaseRequest = {
      baseUrl: bench.baseUrl,
      apiKey: bench.apiKey,
      provider: bench.provider,
      scenarioIds: bench.scenarioIds as BenchRequest["scenarioIds"],
      temperature: bench.temperature,
      max_tokens: bench.max_tokens,
      requestTimeoutMs: bench.requestTimeoutMs,
      warmupRuns: bench.warmupRuns,
      measuredRuns: bench.measuredRuns,
      skipModelLoad: bench.skipModelLoad,
      unloadOtherModels: bench.unloadOtherModels,
      autoUnloadAfterBench: bench.autoUnloadAfterBench,
      loadTtlSeconds: bench.loadTtlSeconds,
      fitPolicy: bench.fitPolicy,
      publicAssetsOrigin: bench.publicAssetsOrigin,
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
    };
    // 큐 전체가 공유하는 "의도" — 모델별 해석은 러너가 benchProfileForModel로 다시 한다.
    const intent: BenchProfileIntent = {
      profileId: bench.profileId as LlmProfileFamily | "auto" | undefined,
      taskMode: bench.taskMode,
      thinkingIntent: bench.thinkingIntent,
      preserveThinking: bench.preserveThinking,
      presetOverride: bench.presetOverride as SamplingPresetName | undefined,
      samplingOverrides: bench.samplingOverrides,
      reasoningEffort: bench.reasoningEffort,
      qwen38ReasoningEffort: bench.qwen38ReasoningEffort,
      profileMaxTokens: bench.profileMaxTokens,
      benchmarkThroughputMode: bench.benchmarkThroughputMode,
    };

    // 계획은 첫 모델 기준으로 한 번만 뽑는다(시나리오·라우트·반복 수는 모델과 무관).
    const planMeta = makeBenchRunMeta(
      benchRequestForQueueModel(base, model_ids[0], intent),
      detect,
      "plan",
    );
    const queueId = randomUUID();
    createQueue({
      queueId,
      baseUrl,
      provider: bench.provider,
      modelIds: model_ids,
      plan: {
        scenario_ids: [...planMeta.scenario_ids],
        api_routes: [...planMeta.api_routes],
        warmup_runs: planMeta.warmup_runs,
        measured_runs: planMeta.measured_runs,
      },
    });
    driveBenchQueue({ queueId, detect, base, intent, modelIds: model_ids });
    const sub = subscribeToQueue(queueId);
    if (!sub) return c.json({ error: "queue_gone" }, 500);
    return c.newResponse(sseStreamFromSubscription(sub), { status: 200, headers: SSE_HEADERS });
  });

  app.get(`${prefix}/bench/queue/:queueId`, (c) => {
    const snapshot = getQueueSnapshot(c.req.param("queueId"));
    if (!snapshot) return c.json({ error: "not_found" }, 404);
    return c.json(snapshot);
  });

  // 진행 중인 큐에 재구독. 완료된 큐는 404 — 클라이언트는 스냅샷의 status를 보고 애초에
  // 여기로 오지 않고 DB 복원 경로를 탄다.
  app.get(`${prefix}/bench/queue/:queueId/reconnect`, (c) => {
    const sub = subscribeToQueue(c.req.param("queueId"));
    if (!sub) return c.json({ error: "not_found" }, 404);
    return c.newResponse(sseStreamFromSubscription(sub), { status: 200, headers: SSE_HEADERS });
  });

  app.post(`${prefix}/bench/queue/:queueId/pause`, (c) => {
    const ok = pauseQueue(c.req.param("queueId"));
    return ok ? c.json({ ok: true }) : c.json({ ok: false, error: "not_found" }, 404);
  });

  app.post(`${prefix}/bench/queue/:queueId/resume`, (c) => {
    const ok = resumeQueue(c.req.param("queueId"));
    return ok ? c.json({ ok: true }) : c.json({ ok: false, error: "not_found" }, 404);
  });

  app.post(`${prefix}/bench/queue/:queueId/stop`, (c) => {
    const ok = requestQueueStop(c.req.param("queueId"));
    return ok ? c.json({ ok: true }) : c.json({ ok: false, error: "not_found" }, 404);
  });

  // 진행 중인 런에 재구독(SSE) — /bench/stream과 달리 새 런을 시작하지 않고 기존 런의
  // 라이브 이벤트를 받는다. 연결 즉시 지금까지의 버퍼링된 이벤트(token_delta 제외)를
  // replay해, 클라이언트가 /bench/stream과 동일한 이벤트 처리 경로로 상태를 재구성할 수 있게 한다.
  app.get(`${prefix}/bench/:runId/reconnect`, (c) => {
    const sub = subscribeToLiveRun(c.req.param("runId"));
    if (!sub) return c.json({ error: "not_found" }, 404);
    return c.newResponse(sseStreamFromSubscription(sub), { status: 200, headers: SSE_HEADERS });
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
      loadTtlSeconds: stress.loadTtlSeconds,
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
