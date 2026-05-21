import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type {
  BenchRunMeta,
  DetectResult,
  StreamEvent,
  LlmProfileFamily,
  SamplingPresetName,
  StressRunMeta,
  StressStreamEvent,
  StressWorkloadId,
} from "@llm-bench/shared";
import {
  SamplingParamsSchema,
  STRESS_WORKLOAD_IDS,
  StressRampConfigSchema,
} from "@llm-bench/shared";
import { makeBenchRunMeta, runBench, type BenchRequest } from "./bench-runner.js";
import { detectProvider } from "./detect.js";
import { registerMonitorRoutes } from "./monitor-routes.js";
import { runStress, type StressRequest } from "./stress-runner.js";

/**
 * DB 모듈은 라우트 핸들러에서 동적 import한다.
 * `tryOpenProdBenchDatabase()` 자체는 null을 반환할 뿐 throw하지 않지만, 모듈 평가 시점(import)이나
 * 마이그레이션 SQL에서 예기치 못한 throw가 나도 `/api/detect`, `/api/health` 등 DB 무관 엔드포인트는
 * 영향 없이 응답하도록 모듈 평가 자체를 라우트 진입 시점까지 지연시킴.
 */

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

/**
 * 클라이언트로 내보내는 SQLite 사용 불가 안내 — 원문 오류(DB 경로·errno 등)는 서버 로그에만 남기고
 * 클라이언트에는 일반화된 문구만 노출. (내부망 도구라도 경로/errno 노출은 줄이는 게 안전.)
 */
const SQLITE_PUBLIC_UNAVAILABLE_MSG =
  "SQLite를 사용할 수 없습니다. 서버 측 DB 경로·권한·잠금 상태를 확인하세요.";

app.get("/api/health", (c) => c.json({ ok: true, service: "llm-bench-server" }));

/** (model_id, base_url)별 최신 finished 런 요약 — 통계 페이지 목록 */
app.get("/api/stats/model-latest", async (c) => {
  try {
    const dbMod = await import("./db/database.js");
    const db = dbMod.tryOpenProdBenchDatabase();
    if (!db) {
      return c.json({
        items: [],
        sqlite_available: false,
        sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG,
      });
    }
    const raw = dbMod.listLatestFinishedRunSummaries(db);
    const items = raw.map((r) => ({
      run_id: r.run_id,
      model_id: r.model_id,
      base_url: r.base_url.replace(/\/+$/, ""),
      provider: r.provider,
      finished_at: r.finished_at,
      created_at: r.created_at,
      status: r.status,
      scenario_count: r.scenario_count,
    }));
    return c.json({ items, sqlite_available: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[llm-bench-server] /api/stats/model-latest DB 로드 실패:", msg);
    return c.json({ items: [], sqlite_available: false, sqlite_error: SQLITE_PUBLIC_UNAVAILABLE_MSG });
  }
});

const RunsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

app.get("/api/runs/latest-by-model", async (c) => {
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
  const norm = q.data.baseUrl.replace(/\/+$/, "");
  try {
    const dbMod = await import("./db/database.js");
    const runQueries = await import("./db/run-queries.js");
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

app.get("/api/runs", async (c) => {
  const parsed = RunsQuery.safeParse({ limit: c.req.query("limit") });
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  try {
    const dbMod = await import("./db/database.js");
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

app.get("/api/runs/:runId", async (c) => {
  const runId = c.req.param("runId");
  if (runId === "latest-by-model") return c.json({ error: "not_found" }, 404);
  try {
    const dbMod = await import("./db/database.js");
    const runQueries = await import("./db/run-queries.js");
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

const STRESS_STATUS_VALUES = ["running", "ok", "partial", "error"] as const;
const emptyStressFilterOptions = () => ({
  workload_ids: [] as string[],
  statuses: [] as Array<(typeof STRESS_STATUS_VALUES)[number]>,
  model_ids: [] as string[],
  base_urls: [] as string[],
});
const normBaseUrl = (u: string) => u.replace(/\/+$/, "");

app.get("/api/stress/runs", async (c) => {
  const q = c.req.query();
  if (q.before && !q.before_id) {
    return c.json({ error: "before_id required when before is set" }, 400);
  }
  if (q.status && !(STRESS_STATUS_VALUES as readonly string[]).includes(q.status)) {
    return c.json({ error: `invalid status: ${q.status}` }, 400);
  }
  const limit = Math.min(Math.max(parseInt(q.limit ?? "50", 10) || 50, 1), 200);
  try {
    const dbMod = await import("./db/database.js");
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

app.get("/api/stress/runs/:runId", async (c) => {
  const runId = c.req.param("runId");
  try {
    const dbMod = await import("./db/database.js");
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

app.delete("/api/stress/runs/:runId", async (c) => {
  const runId = c.req.param("runId");
  try {
    const dbMod = await import("./db/database.js");
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

const DetectBody = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().optional(),
  manual: z
    .object({
      provider: z.enum(["lm_studio", "ollama", "openai_compatible", "manual"]),
      models: z.array(z.object({ id: z.string(), label: z.string().optional() })).optional(),
    })
    .optional(),
});

app.post("/api/detect", async (c) => {
  const body = DetectBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);
  const { baseUrl, apiKey, manual } = body.data;
  try {
    const result = await detectProvider(baseUrl, { apiKey, manual });
    return c.json(result satisfies DetectResult);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

const BenchStreamBody = z.object({
  detect: z.custom<DetectResult>(),
  bench: z.object({
    baseUrl: z.string(),
    apiKey: z.string().optional(),
    provider: z.enum(["lm_studio", "ollama", "openai_compatible", "manual"]),
    modelId: z.string(),
    scenarioIds: z.array(z.string()).optional(),
    parallel: z.boolean().optional(),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    requestTimeoutMs: z.number().int().positive().optional(),
    warmupRuns: z.number().optional(),
    measuredRuns: z.number().optional(),
    skipModelLoad: z.boolean().optional(),
    unloadOtherModels: z.boolean().optional(),
    autoUnloadAfterBench: z.boolean().optional(),
    publicAssetsOrigin: z.string().url().optional(),
    profileId: z.preprocess(
      (v) => (v === "minimax_m27" ? "minimax" : v),
      z
        .enum(["auto", "unknown", "gemma4", "qwen35", "qwen36", "gpt_oss", "minimax", "nemotron3", "qwen3_coder_next", "glm47_flash"])
        .optional(),
    ),
    profileMaxTokens: z.number().int().positive().optional(),
    taskMode: z.enum(["general", "coding", "tool"]).optional(),
    thinkingIntent: z.enum(["on", "off"]).optional(),
    preserveThinking: z.boolean().optional(),
    presetOverride: z
      .enum(["default", "thinking_general", "thinking_coding", "nonthinking_general", "tool_call"])
      .optional(),
    samplingOverrides: SamplingParamsSchema.optional(),
    reasoningEffort: z.enum(["minimal", "low", "medium", "high"]).optional(),
  }),
});

app.post("/api/bench/stream", async (c) => {
  const parsed = BenchStreamBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const { detect, bench } = parsed.data;

  const req: BenchRequest = {
    baseUrl: bench.baseUrl,
    apiKey: bench.apiKey,
    provider: bench.provider,
    modelId: bench.modelId,
    scenarioIds: bench.scenarioIds as BenchRequest["scenarioIds"],
    parallel: bench.parallel,
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
        const dbMod = await import("./db/database.js");
        const { BenchRunPersistence } = await import("./db/persist-stream.js");
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

const StressStreamBody = z.object({
  detect: z.custom<DetectResult>(),
  stress: z.object({
    baseUrl: z.string(),
    apiKey: z.string().optional(),
    provider: z.enum(["lm_studio", "ollama", "openai_compatible", "manual"]),
    modelId: z.string(),
    workloadId: z.enum(STRESS_WORKLOAD_IDS as [StressWorkloadId, ...StressWorkloadId[]]),
    ramp: StressRampConfigSchema,
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().optional(),
    workerPromptSuffix: z.boolean().optional(),
    requestTimeoutMs: z.number().int().positive().optional(),
    skipModelLoad: z.boolean().optional(),
    unloadOtherModels: z.boolean().optional(),
    autoUnloadAfterBench: z.boolean().optional(),
    profileId: z.preprocess(
      (v) => (v === "minimax_m27" ? "minimax" : v),
      z
        .enum([
          "auto",
          "unknown",
          "gemma4",
          "qwen35",
          "qwen36",
          "gpt_oss",
          "minimax",
          "nemotron3",
          "qwen3_coder_next",
          "glm47_flash",
        ])
        .optional(),
    ),
    taskMode: z.enum(["general", "coding", "tool"]).optional(),
    thinkingIntent: z.enum(["on", "off"]).optional(),
    preserveThinking: z.boolean().optional(),
    presetOverride: z
      .enum(["default", "thinking_general", "thinking_coding", "nonthinking_general", "tool_call"])
      .optional(),
    samplingOverrides: SamplingParamsSchema.optional(),
    reasoningEffort: z.enum(["minimal", "low", "medium", "high"]).optional(),
  }),
});

app.post("/api/stress/stream", async (c) => {
  const parsed = StressStreamBody.safeParse(await c.req.json().catch(() => ({})));
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
        const dbMod = await import("./db/database.js");
        const { StressRunPersistence } = await import("./db/stress-persist-stream.js");
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

registerMonitorRoutes(app);

/** `WEB_DIST_PATH`가 있으면 Vite `dist`를 같은 포트에서 서빙(단일 PM2/Node 프로세스). */
const webDistEnv = process.env.WEB_DIST_PATH?.trim();
if (webDistEnv) {
  const webDist = path.resolve(process.cwd(), webDistEnv);
  if (existsSync(webDist)) {
    app.use(
      "/*",
      serveStatic({
        root: webDist,
        rewriteRequestPath: (p) => {
          const rel = p.startsWith("/") ? p.slice(1) : p;
          return rel || "index.html";
        },
      }),
    );
    app.get("*", (c) => {
      if (c.req.path.startsWith("/api")) {
        return c.json({ error: "not_found" }, 404);
      }
      const indexPath = path.join(webDist, "index.html");
      if (!existsSync(indexPath)) {
        return c.text("index.html not found", 404);
      }
      return c.html(readFileSync(indexPath, "utf-8"));
    });
    console.log(`[llm-bench-server] serving web dist from ${webDist}`);
  } else {
    console.warn(`[llm-bench-server] WEB_DIST_PATH set but missing: ${webDist}`);
  }
}

const port = Number(process.env.PORT ?? 20080);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`llm-bench-server listening on http://localhost:${info.port}`);
});

// 정상 종료(SIGTERM/SIGINT) 시 SQLite WAL truncate 후 close — Docker/PM2 운영에서 WAL 사이즈 폭주 방지
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, async () => {
    try {
      const dbMod = await import("./db/database.js");
      dbMod.closeProdBenchDatabase();
    } catch {
      // DB 모듈이 로드된 적 없으면 무시
    }
    process.exit(0);
  });
}
