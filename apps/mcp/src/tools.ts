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
import { BenchHttpError, isQueueActiveError, type BenchClient } from "./bench-client.js";
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

/** 로드 TTL 기본값(초) — 모델이 백엔드에 무기한 상주하지 않도록 하는 안전장치. */
const DEFAULT_LOAD_TTL_SECONDS = 3600;

/** 큐가 비었는지 확인하는 간격. 벤치 큐의 모델 1건은 분 단위라 더 촘촘히 물어봐야 얻는 게 없다. */
const QUEUE_POLL_INTERVAL_MS = 5_000;
/** 대기 예산과 별개인 재시도 상한 — 큐가 연달아 새로 뜨면 예산만으로는 루프가 길어질 수 있다. */
const MAX_QUEUE_RETRIES = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 이 baseUrl을 지금 점유 중인 큐. `/bench/running`의 `queues`에는 TTL(30분) 안의 **완료 큐도** 들어오므로
 * 목록이 비었는지로 판단하면 안 된다 — status가 "running"인 것만 점유로 센다.
 */
async function runningQueueFor(
  client: BenchClient,
  baseUrl: string,
): Promise<{ queue_id?: string; index?: number; models?: Array<{ model_id?: string }> } | null> {
  const res = await client.getJson<{
    queues?: Array<{ queue_id?: string; status?: string; index?: number; models?: Array<{ model_id?: string }> }>;
  }>(`/bench/running?baseUrl=${encodeURIComponent(baseUrl)}`);
  return (res.queues ?? []).find((q) => q.status === "running") ?? null;
}

/** 예산 안에서 큐가 비기를 기다린다. 비면 true, 예산 소진이면 false — 어느 쪽이든 반드시 끝난다. */
async function waitUntilQueueIdle(client: BenchClient, baseUrl: string, deadline: number): Promise<boolean> {
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await sleep(Math.min(QUEUE_POLL_INTERVAL_MS, remaining));
    try {
      if ((await runningQueueFor(client, baseUrl)) === null) return true;
    } catch {
      // 폴링 실패는 "큐 상태 모름"일 뿐이라 대기를 접지 않는다 — 예산이 상한 역할을 한다.
    }
  }
}

/** 409 queue_active 본문에서 에이전트가 쓸 수 있는 값만 추린다(어느 큐를, 어느 모델에서 기다리는지). */
function queueActiveInfo(e: BenchHttpError): Record<string, unknown> {
  const p = e.payload ?? {};
  return {
    reason: "queue_active",
    base_url: p.base_url ?? null,
    queue_id: p.queue_id ?? null,
    queue_model_id: p.model_id ?? null,
  };
}

/**
 * 409 `run_active` — 같은 baseUrl을 **단발** 런이 점유 중이다(큐가 아니다).
 * `waitForIdleMs`는 큐가 비기만 기다리므로 이 거부는 대기 대상이 아니라 즉시 실패다.
 */
function isRunActiveError(e: unknown): e is BenchHttpError {
  return e instanceof BenchHttpError && e.status === 409 && e.payload?.error === "run_active";
}

/** 409 run_active 본문에서 후속 행동(어느 런을 기다리거나 세울지)의 근거가 되는 값만 추린다. */
function runActiveInfo(e: BenchHttpError): Record<string, unknown> {
  const p = e.payload ?? {};
  return {
    reason: "run_active",
    base_url: p.base_url ?? null,
    run_id: p.run_id ?? null,
    run_model_id: p.model_id ?? null,
    waitable: false,
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
        "token 스트림은 버리고 시나리오별 TTFT/TPS/품질 요약 + 랭킹 롤업을 반환. 진행은 progress 알림으로 전달. " +
        "같은 baseUrl에서 서버 큐가 실행 중이면 409 queue_active로 거부된다(측정이 겹치면 조용히 오염되므로). " +
        "거부 대신 큐가 끝나기를 기다리려면 waitForIdleMs를 주라 — 이 대기는 **큐에만** 적용된다. " +
        "다른 단발 런이 점유 중이라는 409 run_active는 대기 없이 즉시 실패하며, 막고 있는 run_id를 결과에 담는다.",
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
        /** 로드 시 TTL(초). 지원 백엔드(lm_studio·ollama)에서만 적용, 그 외는 무시. */
        /**
         * 로드 TTL(초). 기본 1시간 — 지정하지 않으면 이 하네스가 올린 모델이 백엔드에 영구 상주해
         * 다음 벤치의 메모리 여유를 갉아먹는다. LM Studio는 이미 로드된 모델의 TTL을 바꾸지 않으므로
         * 사후에 되돌릴 수 없다. 상주시키려면 아주 큰 값을 명시하라.
         */
        loadTtlSeconds: z.number().int().positive().optional(),
        /**
         * 서버 **큐**가 이 baseUrl을 점유해 409 queue_active를 받았을 때 기다릴 최대 시간(ms). 기본 0 = 즉시 실패.
         * >0이면 5초 간격으로 `/bench/running`을 확인해 큐가 끝나면 자동 재시도한다(재시도 상한 20회).
         * 409 run_active(단발 런 점유)에는 적용되지 않는다 — 그건 언제나 즉시 실패다.
         */
        waitForIdleMs: z.number().int().nonnegative().optional(),
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
          loadTtlSeconds: args.loadTtlSeconds ?? DEFAULT_LOAD_TTL_SECONDS,
        };
        const waitBudgetMs = args.waitForIdleMs ?? 0;
        const deadline = Date.now() + waitBudgetMs;
        for (let attempt = 0; ; attempt += 1) {
          try {
            const result = await drainBenchStream(client, cfg, { detect, bench }, extra as ProgressExtra);
            return ok(result);
          } catch (e) {
            // run_active는 큐가 아니라 **단발** 런이 baseUrl을 점유한 경우다 — waitForIdleMs는
            // 큐만 기다리므로 여기서 대기 루프에 넣으면 영원히 못 빠져나온다. 즉시 실패시키되
            // 어느 런이 막고 있는지와 다음 행동을 메시지에 남긴다.
            // 현재 /bench/stream은 run_active를 내지 않는다(큐 시작만 이 코드로 거부된다).
            // 서버가 나중에 단발끼리도 막게 되면 그때 이 분기가 살아난다.
            if (isRunActiveError(e)) {
              return fail(
                `${e.message} — 같은 baseUrl에서 다른 단발 벤치 런이 실행 중이라 거부됐다(큐가 아니다). ` +
                  `waitForIdleMs는 서버 큐만 기다리므로 이 거부에는 효과가 없다 — ` +
                  `GET /bench/running의 runs[]에서 그 런이 끝나기를 확인하거나 ` +
                  `POST /bench/{runId}/stop으로 세운 뒤 다시 부르라.`,
                runActiveInfo(e),
              );
            }
            if (!isQueueActiveError(e)) throw e;
            const info = queueActiveInfo(e);
            if (waitBudgetMs <= 0) {
              return fail(
                `${e.message} — 서버 벤치 큐가 이 baseUrl을 점유 중이라 실행을 거부했다. ` +
                  `큐가 끝나기를 기다리려면 waitForIdleMs(ms)를 지정하라.`,
                info,
              );
            }
            const budgetExhausted = () =>
              fail(
                `${e.message} — 서버 벤치 큐가 waitForIdleMs=${waitBudgetMs}ms 안에 끝나지 않았다. ` +
                  `큐 진행은 GET /bench/running으로 확인하고, 더 긴 waitForIdleMs로 다시 부르라.`,
                { ...info, retries: attempt },
              );
            // 재시도 상한과 대기 예산은 서로 다른 한계다. 예산이 남았는데 상한에 걸린 걸
            // "시간 안에 안 끝났다"고 보고하면, 에이전트는 waitForIdleMs만 늘려 같은 벽에 다시 부딪힌다.
            if (attempt >= MAX_QUEUE_RETRIES) {
              const remainingMs = Math.max(0, deadline - Date.now());
              if (remainingMs <= 0) return budgetExhausted();
              return fail(
                `${e.message} — 큐가 빌 때마다 새 큐가 올라와 재시도 상한(${MAX_QUEUE_RETRIES}회)에 걸렸다. ` +
                  `waitForIdleMs 예산은 아직 ${remainingMs}ms 남아 있으므로 예산을 늘려도 같은 결과다 — ` +
                  `GET /bench/running으로 누가 큐를 계속 올리는지 확인하고 그쪽을 멈춘 뒤 다시 부르라.`,
                { ...info, retries: attempt, wait_budget_remaining_ms: remainingMs },
              );
            }
            // 서버의 직렬 실행 락은 정규화된 detect.baseUrl로 걸린다 — 409 본문이 알려준 그 값으로
            // 폴링해야 한다. args.baseUrl(사용자 입력 표기)로 물으면 유휴로 오판해 409만 반복해 맞는다.
            const lockBaseUrl = typeof info.base_url === "string" && info.base_url ? info.base_url : args.baseUrl;
            if (!(await waitUntilQueueIdle(client, lockBaseUrl, deadline))) return budgetExhausted();
          }
        }
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
        task: z.enum(["coding", "vision", "tools", "structured", "chat", "agent"]).optional(),
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
    "compare_runs",
    {
      title: "#84 런/모델 회귀 diff('X가 회귀했나?')",
      description:
        "두 런(runA/runB) 또는 두 모델 최신 런(modelA/modelB+baseUrl)의 per-scenario TTFT p50/p95·TPS·품질·정체/누수 델타 + regression 플래그. LM Studio 업그레이드 후 회귀 확인에 사용.",
      inputSchema: {
        runA: z.string().optional(),
        runB: z.string().optional(),
        modelA: z.string().optional(),
        modelB: z.string().optional(),
        baseUrl: z.string().optional(),
        qualityDropAbs: z.number().optional(),
        tpsRegressionPct: z.number().optional(),
        ttftRegressionPct: z.number().optional(),
        flagNewEmptyTurns: z.boolean().optional(),
      },
    },
    async (args) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(args)) {
        if (v !== undefined && v !== null) qs.set(k, String(v));
      }
      return ok(await client.getJson(`/compare?${qs.toString()}`));
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
