import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { DetectResult, StreamEvent } from "@llm-bench/shared";
import { detectProvider } from "./detect.js";
import { runBench, type BenchRequest } from "./bench-runner.js";

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
  };

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (ev: StreamEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      try {
        for await (const ev of runBench(req, detect)) {
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
