import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { BenchRunMeta, DetectResult, StreamEvent, LlmProfileFamily, SamplingPresetName } from "@llm-bench/shared";
import { SamplingParamsSchema } from "@llm-bench/shared";
import { makeBenchRunMeta, runBench, type BenchRequest } from "./bench-runner.js";
import { detectProvider } from "./detect.js";

/** better-sqlite3는 여기서 정적 import하지 않음 — 네이티브 로드 실패 시에도 감지(/api/detect)가 동작하도록 동적 import */

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

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
        sqlite_error: dbMod.getProdBenchDatabaseOpenError(),
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
    return c.json({ items: [], sqlite_available: false, sqlite_error: msg });
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
        sqlite_error: dbMod.getProdBenchDatabaseOpenError(),
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
      sqlite_error: msg,
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
        sqlite_error: dbMod.getProdBenchDatabaseOpenError(),
      });
    }
    const rows = dbMod.listRecentRuns(db, parsed.data.limit);
    return c.json({ runs: rows, sqlite_available: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[llm-bench-server] /api/runs DB 로드 실패:", msg);
    return c.json({ runs: [], sqlite_available: false, sqlite_error: msg });
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
          message: "SQLite를 사용할 수 없습니다. 히스토리를 조회할 수 없습니다.",
          detail: dbMod.getProdBenchDatabaseOpenError(),
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
    return c.json({ error: "sqlite_load_failed", message: msg }, 503);
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
    profileId: z.enum(["auto", "unknown", "gemma4", "qwen35", "qwen36", "gpt_oss", "minimax_m27", "nemotron3", "qwen3_coder_next", "glm47_flash"]).optional(),
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
