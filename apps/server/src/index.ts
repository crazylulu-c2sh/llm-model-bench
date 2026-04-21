import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { BenchRunMeta, DetectResult, StreamEvent } from "@llm-bench/shared";
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
    warmupRuns: z.number().optional(),
    measuredRuns: z.number().optional(),
    skipModelLoad: z.boolean().optional(),
    unloadOtherModels: z.boolean().optional(),
    publicAssetsOrigin: z.string().url().optional(),
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
    warmupRuns: bench.warmupRuns,
    measuredRuns: bench.measuredRuns,
    skipModelLoad: bench.skipModelLoad,
    unloadOtherModels: bench.unloadOtherModels,
    publicAssetsOrigin: bench.publicAssetsOrigin,
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

const port = Number(process.env.PORT ?? 20080);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`llm-bench-server listening on http://localhost:${info.port}`);
});
