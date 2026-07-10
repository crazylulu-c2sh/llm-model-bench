import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DetectResultSchema,
  ProviderKindSchema,
  SamplingParamsSchema,
  StressRampConfigSchema,
  STRESS_WORKLOAD_IDS,
  averageRunsToScoringRow,
  computeScoreboard,
  scoringRowsFromBenchDetails,
  type DetectResult,
  type StreamEvent,
} from "@llm-bench/shared";
import type { McpConfig } from "./config.js";
import type { BenchClient } from "./bench-client.js";
import { consumeSseJsonLines } from "./sse.js";

/** 도구 결과 헬퍼 — compact JSON을 text content로 반환(구조화 파싱 가능). */
function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}
function fail(message: string, data?: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message, ...(data ? { data } : {}) }) }],
    isError: true,
  };
}

type ScenarioRun = {
  ttft_ms: number | null;
  total_ms: number;
  output_text: string;
  usage_output_tokens?: number | null;
  quality?: { pass: boolean; score?: number; reason?: string };
};
type BenchDetail = {
  meta: { model_id: string };
  scenarios: Array<{ id: string; api_route: string; runs: ScenarioRun[] }>;
};

function avg(nums: number[]): number | null {
  const v = nums.filter((n) => Number.isFinite(n));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** 저장된 벤치 상세 → compact 요약(shared averageRunsToScoringRow/computeScoreboard 재사용). */
function compactFromDetail(detail: BenchDetail) {
  const model_id = detail.meta.model_id;
  const scenarios = detail.scenarios.map((sc) => {
    const row = averageRunsToScoringRow(model_id, sc.id, sc.api_route, sc.runs);
    return {
      id: sc.id,
      api_route: sc.api_route,
      runs: sc.runs.length,
      avg_ttft_ms: row.ttft_ms,
      avg_total_ms: avg(sc.runs.map((r) => r.total_ms)),
      tps: row.tps,
      score: row.score,
      pass: row.score != null ? row.score >= 0.67 : undefined,
    };
  });
  const board = computeScoreboard(scoringRowsFromBenchDetails([detail]));
  const rollup = board[0]
    ? { quality: board[0].quality.total, speed: board[0].speed.total, textOnly: board[0].textOnly }
    : null;
  return { model_id, scenarios, rollup };
}

interface ProgressExtra {
  _meta?: { progressToken?: string | number };
  sendNotification: (n: unknown) => Promise<void>;
}

/** bench/stream을 드레인 — token_delta 폐기, scenario_end마다 progress 알림, 종료 후 canonical 회수. */
async function drainBenchStream(
  client: BenchClient,
  cfg: McpConfig,
  streamBody: { detect: DetectResult; bench: { modelId: string } & Record<string, unknown> },
  extra: ProgressExtra,
) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.httpTimeoutMs);
  const progressToken = extra?._meta?.progressToken;
  let runId: string | undefined;
  let total = 0;
  let completed = 0;
  const evScenarios: Array<{ id: string; pass: boolean; score: number | null; ttft_ms: number | null; total_ms: number }> = [];
  let fatalError: string | undefined;
  let timedOut = false;

  try {
    const res = await client.postStream("/bench/stream", streamBody, ac.signal);
    await consumeSseJsonLines<StreamEvent>(res.body!, (ev) => {
      if (ev.type === "run_started") {
        runId = ev.run_id;
        total = ev.meta?.scenario_ids?.length ?? 0;
      } else if (ev.type === "scenario_end") {
        completed += 1;
        evScenarios.push({
          id: ev.scenario_id,
          pass: ev.quality?.pass ?? false,
          score: ev.quality?.score ?? null,
          ttft_ms: ev.metrics.ttft_ms ?? null,
          total_ms: ev.metrics.total_ms,
        });
        if (progressToken !== undefined) {
          void extra
            .sendNotification({
              method: "notifications/progress",
              params: {
                progressToken,
                progress: completed,
                ...(total ? { total } : {}),
                message: `${ev.scenario_id}: pass=${ev.quality?.pass ?? false}`,
              },
            })
            .catch(() => {});
        }
      } else if (ev.type === "error" && ev.layer === "orchestrator") {
        fatalError = `${ev.code}: ${ev.message}`;
      }
    });
  } catch (e) {
    if (ac.signal.aborted) timedOut = true;
    else throw e;
  } finally {
    clearTimeout(timer);
  }

  // canonical 회수 — /bench/stream은 클라이언트 abort 후에도 서버에서 계속 실행되므로 여기서 되읽는다.
  let detail: BenchDetail | null = null;
  if (runId) {
    try {
      detail = await client.getJson<BenchDetail>(`/runs/${runId}`);
    } catch {
      detail = null; // sqlite 미가용 등 → event 집계로 폴백
    }
  }
  const status = fatalError ? "error" : timedOut ? "timeout" : "ok";
  if (detail && Array.isArray(detail.scenarios) && detail.scenarios.length > 0) {
    return {
      run_id: runId,
      status,
      ...compactFromDetail(detail),
      ...(timedOut ? { serverKeepsRunning: true } : {}),
      ...(fatalError ? { error: fatalError } : {}),
    };
  }
  return {
    run_id: runId,
    status,
    model_id: streamBody.bench.modelId,
    scenarios: evScenarios,
    sqlite_available: false,
    ...(timedOut ? { serverKeepsRunning: true } : {}),
    ...(fatalError ? { error: fatalError } : {}),
  };
}

export function registerTools(server: McpServer, client: BenchClient, cfg: McpConfig): void {
  server.registerTool(
    "health",
    { title: "Bench 서버 라이브니스", description: "벤치 API 서버가 살아있는지 확인." },
    async () => ok(await client.getJson("/health")),
  );

  server.registerTool(
    "list_scenarios",
    {
      title: "시나리오 카탈로그",
      description: "벤치 시나리오(text/vision) 목록과 메타. run_bench 전에 scenarioIds를 고를 때 사용.",
      inputSchema: { set: z.enum(["public", "default", "vision", "agent", "custom", "all"]).optional() },
    },
    async ({ set }) => ok(await client.getJson(`/scenarios${set ? `?set=${set}` : ""}`)),
  );

  server.registerTool(
    "list_capabilities",
    {
      title: "카탈로그(시나리오+프로파일+워크로드)",
      description: "무엇을 벤치할 수 있고 어떻게 채점되는지 한 번에.",
    },
    async () => ok(await client.getJson("/catalog")),
  );

  server.registerTool(
    "detect_provider",
    {
      title: "provider 감지 + 모델 목록(먼저 실행)",
      description: "baseUrl의 LLM provider를 감지하고 모델·capability를 반환. run_bench에 넘길 DetectResult.",
      inputSchema: {
        baseUrl: z.string(),
        apiKey: z.string().optional(),
      },
    },
    async ({ baseUrl, apiKey }) => ok(await client.postJson("/detect", { baseUrl, apiKey })),
  );

  server.registerTool(
    "run_bench",
    {
      title: "모델 벤치 실행(진행 스트리밍, compact 결과)",
      description:
        "선택 시나리오로 한 모델을 벤치한다. detect를 넘기면 재감지 스킵, 아니면 baseUrl/apiKey로 내부 감지. " +
        "token 스트림은 버리고 시나리오별 TTFT/TPS/품질 요약 + 랭킹 롤업을 반환. 진행은 progress 알림으로 전달.",
      inputSchema: {
        baseUrl: z.string(),
        apiKey: z.string().optional(),
        modelId: z.string(),
        detect: DetectResultSchema.optional(),
        scenarioIds: z.array(z.string()).optional(),
        measuredRuns: z.number().int().positive().optional(),
        warmupRuns: z.number().int().nonnegative().optional(),
        temperature: z.number().optional(),
        max_tokens: z.number().int().positive().optional(),
        apiRoutes: z.array(z.enum(["chat_completions", "messages"])).optional(),
        /** #81: 메모리-핏 프리플라이트 정책(LM Studio). 미지정이면 예측만 로그 후 진행. */
        fitPolicy: z.enum(["skip", "unload_other_models"]).optional(),
      },
    },
    async (args, extra) => {
      try {
        let detect = args.detect;
        if (!detect) {
          detect = await client.postJson<DetectResult>("/detect", {
            baseUrl: args.baseUrl,
            apiKey: args.apiKey,
          });
        }
        const bench = {
          baseUrl: args.baseUrl,
          apiKey: args.apiKey,
          provider: detect.provider,
          modelId: args.modelId,
          scenarioIds: args.scenarioIds,
          measuredRuns: args.measuredRuns,
          warmupRuns: args.warmupRuns,
          temperature: args.temperature,
          max_tokens: args.max_tokens,
          apiRoutes: args.apiRoutes,
          fitPolicy: args.fitPolicy,
        };
        const result = await drainBenchStream(client, cfg, { detect, bench }, extra as ProgressExtra);
        return ok(result);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "run_stress",
    {
      title: "프로바이더 스트레스(동시성 램프) 실행",
      description: "workload를 동시성 램프로 실행하고 스테이지별 처리량·지연 요약을 반환. abort는 실제로 서버 실행을 취소.",
      inputSchema: {
        baseUrl: z.string(),
        apiKey: z.string().optional(),
        modelId: z.string(),
        detect: DetectResultSchema.optional(),
        workloadId: z.enum(STRESS_WORKLOAD_IDS as [string, ...string[]]),
        ramp: StressRampConfigSchema,
        maxTokens: z.number().int().positive().optional(),
        temperature: z.number().optional(),
        samplingOverrides: SamplingParamsSchema.optional(),
      },
    },
    async (args, extra) => {
      try {
        let detect = args.detect;
        if (!detect) {
          detect = await client.postJson<DetectResult>("/detect", {
            baseUrl: args.baseUrl,
            apiKey: args.apiKey,
          });
        }
        const stress = {
          baseUrl: args.baseUrl,
          apiKey: args.apiKey,
          provider: detect.provider,
          modelId: args.modelId,
          workloadId: args.workloadId,
          ramp: args.ramp,
          maxTokens: args.maxTokens,
          temperature: args.temperature,
          samplingOverrides: args.samplingOverrides,
        };
        const result = await drainStressStream(client, cfg, { detect, stress }, extra as ProgressExtra);
        return ok(result);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "compare_models",
    {
      title: "모델 랭킹 스코어보드('X에 어떤 모델이 최고?')",
      description: "저장된 최신 런에서 품질·속도 랭킹을 반환. modelIds 생략 시 baseUrl의 모든 모델. task로 시나리오 필터.",
      inputSchema: {
        baseUrl: z.string(),
        modelIds: z.array(z.string()).optional(),
        task: z.enum(["coding", "vision", "tools", "structured", "chat"]).optional(),
      },
    },
    async ({ baseUrl, modelIds, task }) => {
      const qs = new URLSearchParams({ baseUrl });
      if (modelIds && modelIds.length) qs.set("modelIds", modelIds.join(","));
      if (task) qs.set("task", task);
      return ok(await client.getJson(`/scoreboard?${qs.toString()}`));
    },
  );

  server.registerTool(
    "list_runs",
    {
      title: "저장된 런 목록",
      description: "최근 벤치(또는 스트레스) 런 요약.",
      inputSchema: {
        kind: z.enum(["bench", "stress"]).optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ kind, limit }) => {
      if (kind === "stress") return ok(await client.getJson("/stress/runs"));
      return ok(await client.getJson(`/runs${limit ? `?limit=${limit}` : ""}`));
    },
  );

  server.registerTool(
    "get_run",
    {
      title: "런 상세",
      description: "벤치 또는 스트레스 런의 전체 상세(측정 런 포함).",
      inputSchema: {
        runId: z.string(),
        kind: z.enum(["bench", "stress"]).optional(),
      },
    },
    async ({ runId, kind }) => {
      const path = kind === "stress" ? `/stress/runs/${runId}` : `/runs/${runId}`;
      return ok(await client.getJson(path));
    },
  );

  server.registerTool(
    "monitor_snapshot",
    {
      title: "시스템·GPU·로드된 모델 스냅샷",
      description: "provider 호스트의 시스템·GPU·로드된 모델 상태.",
      inputSchema: {
        baseUrl: z.string(),
        provider: ProviderKindSchema,
        apiKey: z.string().optional(),
      },
    },
    async ({ baseUrl, provider, apiKey }) =>
      ok(await client.postJson("/monitor/snapshot", { baseUrl, provider, apiKey })),
  );
}

/** stress/stream 드레인 — 이벤트를 흘려보내고 종료 후 canonical 상세를 회수. abort는 서버 실행을 실제 취소. */
async function drainStressStream(
  client: BenchClient,
  cfg: McpConfig,
  streamBody: { detect: DetectResult; stress: Record<string, unknown> },
  extra: ProgressExtra,
) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.httpTimeoutMs);
  const progressToken = extra?._meta?.progressToken;
  let runId: string | undefined;
  let stageCount = 0;
  let fatalError: string | undefined;
  let timedOut = false;

  try {
    const res = await client.postStream("/stress/stream", streamBody, ac.signal);
    await consumeSseJsonLines<Record<string, unknown>>(res.body!, (ev) => {
      const type = ev.type as string | undefined;
      if (type === "run_started") {
        const meta = ev.meta as { run_id?: string } | undefined;
        runId = meta?.run_id ?? (ev.run_id as string | undefined);
      } else if (type === "stage_end" || type === "stage") {
        stageCount += 1;
        if (progressToken !== undefined) {
          void extra
            .sendNotification({
              method: "notifications/progress",
              params: { progressToken, progress: stageCount, message: `stage ${stageCount}` },
            })
            .catch(() => {});
        }
      } else if (type === "error") {
        fatalError = `${ev.code ?? "error"}: ${ev.message ?? ""}`;
      }
    });
  } catch (e) {
    if (ac.signal.aborted) timedOut = true;
    else throw e;
  } finally {
    clearTimeout(timer);
  }

  let detail: unknown = null;
  if (runId) {
    try {
      detail = await client.getJson(`/stress/runs/${runId}`);
    } catch {
      detail = null;
    }
  }
  const status = fatalError ? "error" : timedOut ? "timeout" : "ok";
  return {
    run_id: runId,
    status,
    detail,
    ...(timedOut ? { serverKeepsRunning: false } : {}),
    ...(fatalError ? { error: fatalError } : {}),
  };
}
