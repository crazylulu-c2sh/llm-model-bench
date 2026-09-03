import type { Page, Route } from "@playwright/test";

/**
 * 모델 벤치("/") e2e 공용 목업.
 *
 * e2e webServer는 백엔드 없는 정적 프리뷰라 API를 전부 `page.route`로 고정한다. 서버가 모델 큐를
 * 소유하게 된 뒤로 앱이 부르는 라우트가 늘어나(`POST /bench/queue`, `GET /bench/running`,
 * `GET /bench/queue/:id/reconnect`, `GET /runs/:runId`) 스펙마다 복사하면 계약이 어긋나기 시작한다 —
 * 여기 한 곳에 모아 두고 스펙은 시나리오만 고른다.
 *
 * `helpers/`는 playwright testMatch(`**\/*.spec.ts`)에 걸리지 않으므로 테스트로 수집되지 않는다.
 *
 * 타입은 `@llm-bench/shared`를 그대로 쓰지 않고 구조만 옮겨 적는다 — 루트 워크스페이스에는
 * 그 패키지가 링크돼 있지 않고, e2e는 "서버가 실제로 내보내는 JSON"을 흉내 내는 쪽이 맞다.
 * (원본: packages/shared/src/bench-queue.ts, packages/shared/src/index.ts)
 */

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export type ApiRoute = "chat_completions" | "messages";

export type QueueModelStatus =
  | "pending"
  | "running"
  | "paused"
  | "done"
  | "done-with-errors"
  | "failed"
  | "cancelled";

/** 서버가 큐 전체에 대해 확정한 계획(`BenchQueuePlan`). */
export type QueuePlan = {
  scenario_ids: string[];
  api_routes: ApiRoute[];
  warmup_runs: number;
  measured_runs: number;
};

export type QueueEvent = Record<string, unknown>;

/** 이 시나리오가 이 모델에서 어떤 수치로 끝났는지. 표에 실제 값이 찍히는지 확인하려고 고정한다. */
export type ScenarioFixture = {
  id: string;
  api?: ApiRoute;
  ttftMs?: number;
  totalMs?: number;
  text?: string;
  outputTokens?: number;
};

type ResolvedScenario = Required<ScenarioFixture>;

function resolveScenario(s: ScenarioFixture, i: number): ResolvedScenario {
  return {
    id: s.id,
    api: s.api ?? "chat_completions",
    ttftMs: s.ttftMs ?? 100 + i * 10,
    totalMs: s.totalMs ?? 800 + i * 100,
    text: s.text ?? `e2e output ${s.id}`,
    outputTokens: s.outputTokens ?? 10 + i,
  };
}

// ---------------------------------------------------------------- SSE

export function sse(events: ReadonlyArray<QueueEvent>): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
}

// ---------------------------------------------------------------- 감지

export type DetectFixture = ReturnType<typeof makeDetect>;

export function makeDetect(options: { baseUrl: string; modelIds: string[]; provider?: string }) {
  return {
    provider: options.provider ?? "lm_studio",
    baseUrl: options.baseUrl,
    models: options.modelIds.map((id, i) => ({
      id,
      publisher: "e2e",
      params_string: `${7 + i}B`,
      size_bytes: (4 + i) * 1024 ** 3,
    })),
    steps: [{ name: "models", ok: true }],
    capabilities: { openaiChat: true, anthropicMessages: false },
    reachability: { state: "ok" },
  };
}

export async function mockDetect(page: Page, detect: DetectFixture): Promise<void> {
  await page.route("**/api/detect", (route) => fulfillJson(route, detect));
}

// ---------------------------------------------------------------- 큐 이벤트

/**
 * 모델 1건이 큐 안에서 통째로 지나가는 이벤트열.
 *
 * `metrics_update`가 없으면 rows가 비어 결과 단계가 열리지 않는다 — 결과 행은 `scenario_end`가
 * 아니라 aggregate에서 만들어진다.
 */
export function modelQueueEvents(options: {
  queueId: string;
  index: number;
  modelId: string;
  runId: string;
  baseUrl: string;
  provider?: string;
  scenarios: ScenarioFixture[];
  plan: QueuePlan;
  status?: QueueModelStatus;
}): QueueEvent[] {
  const provider = options.provider ?? "lm_studio";
  const scenarios = options.scenarios.map(resolveScenario);
  const events: QueueEvent[] = [
    {
      type: "queue_model_started",
      queue_id: options.queueId,
      index: options.index,
      model_id: options.modelId,
    },
    {
      type: "run_started",
      run_id: options.runId,
      meta: {
        run_id: options.runId,
        base_url: options.baseUrl,
        provider,
        model_id: options.modelId,
        api_routes: options.plan.api_routes,
        scenario_ids: options.plan.scenario_ids,
        scenario_bundle_version: "e2e",
        temperature: 0,
        max_tokens: 512,
        warmup_runs: options.plan.warmup_runs,
        measured_runs: options.plan.measured_runs,
      },
    },
  ];
  for (const sc of scenarios) {
    events.push({ type: "scenario_start", scenario_id: sc.id, api_route: sc.api });
    events.push({
      type: "scenario_end",
      scenario_id: sc.id,
      api_route: sc.api,
      metrics: {
        ttft_ms: sc.ttftMs,
        total_ms: sc.totalMs,
        output_chars: sc.text.length,
        approx_tokens: sc.outputTokens,
        usage_output_tokens: sc.outputTokens,
        stream_completed: true,
      },
      quality: { pass: true },
    });
    events.push({
      type: "metrics_update",
      aggregate: {
        scenario_id: sc.id,
        api_route: sc.api,
        runs: [
          {
            ttft_ms: sc.ttftMs,
            total_ms: sc.totalMs,
            output_text: sc.text,
            stream_completed: true,
            usage_output_tokens: sc.outputTokens,
            quality: { pass: true, score: 1 },
          },
        ],
      },
    });
  }
  events.push({ type: "run_finished", run_id: options.runId });
  events.push({
    type: "queue_model_finished",
    queue_id: options.queueId,
    index: options.index,
    model_id: options.modelId,
    run_id: options.runId,
    status: options.status ?? "done",
    error_count: 0,
  });
  return events;
}

/** 큐 스냅샷 `models[]`의 한 칸. */
export function queueModel(options: {
  modelId: string;
  status: QueueModelStatus;
  runId?: string | null;
  errorCount?: number;
}) {
  return {
    model_id: options.modelId,
    status: options.status,
    run_id: options.runId ?? null,
    started_at: options.status === "pending" ? null : 1_700_000_000_000,
    finished_at: options.status === "pending" || options.status === "running" ? null : 1_700_000_060_000,
    error_count: options.errorCount ?? 0,
  };
}

/**
 * 큐 스트림 전체(`queue_started` … `queue_finished`).
 *
 * `fromIndex` 앞의 모델은 이미 끝난 것으로 보고 런 이벤트를 넣지 않는다 — 재연결 replay에서
 * 서버가 지난 모델의 토큰까지 되돌려주지는 않기 때문이다(끝난 모델은 DB에서 복원한다).
 */
export function queueStreamEvents(options: {
  queueId: string;
  baseUrl: string;
  provider?: string;
  modelIds: string[];
  plan: QueuePlan;
  scenarios: ScenarioFixture[];
  runIdFor: (modelId: string, index: number) => string;
  fromIndex?: number;
}): QueueEvent[] {
  const provider = options.provider ?? "lm_studio";
  const fromIndex = options.fromIndex ?? 0;
  const events: QueueEvent[] = [
    {
      type: "queue_started",
      queue_id: options.queueId,
      base_url: options.baseUrl,
      provider,
      model_ids: options.modelIds,
      plan: options.plan,
    },
  ];
  options.modelIds.forEach((modelId, index) => {
    if (index < fromIndex) return;
    events.push(
      ...modelQueueEvents({
        queueId: options.queueId,
        index,
        modelId,
        runId: options.runIdFor(modelId, index),
        baseUrl: options.baseUrl,
        provider,
        scenarios: options.scenarios,
        plan: options.plan,
      }),
    );
  });
  events.push({
    type: "queue_finished",
    queue_id: options.queueId,
    status: "finished",
    models: options.modelIds.map((modelId, index) =>
      queueModel({ modelId, status: "done", runId: options.runIdFor(modelId, index) }),
    ),
  });
  return events;
}

// ---------------------------------------------------------------- 라우트 목업

/** `POST /api/bench/queue` — 요청 바디의 `model_ids`를 그대로 실행하는 큐 스트림을 돌려준다. */
export async function mockQueueStart(
  page: Page,
  options: {
    queueId: string;
    baseUrl: string;
    provider?: string;
    plan: QueuePlan;
    scenarios: ScenarioFixture[];
    runIdFor?: (modelId: string, index: number) => string;
  },
): Promise<void> {
  const runIdFor = options.runIdFor ?? ((modelId) => `${options.queueId}-${modelId}`);
  await page.route("**/api/bench/queue", (route) => {
    const body = route.request().postDataJSON() as { model_ids?: string[] } | null;
    const modelIds = body?.model_ids ?? [];
    return route.fulfill({
      contentType: "text/event-stream",
      body: sse(
        queueStreamEvents({
          queueId: options.queueId,
          baseUrl: options.baseUrl,
          provider: options.provider,
          modelIds,
          plan: options.plan,
          scenarios: options.scenarios,
          runIdFor,
        }),
      ),
    });
  });
}

/** `GET /api/bench/running` — 감지 직후 앱이 곧바로 부른다. 큐가 없으면 빈 배열 둘. */
export async function mockBenchRunning(
  page: Page,
  payload: { runs?: unknown[]; queues?: unknown[] } = {},
): Promise<void> {
  await page.route("**/api/bench/running*", (route) =>
    fulfillJson(route, { runs: payload.runs ?? [], queues: payload.queues ?? [] }),
  );
}

/**
 * `GET /api/bench/queue/:id/reconnect`.
 *
 * `route.fulfill`은 본문을 한 번에 보내고 스트림을 닫으므로, 응답을 미뤄 두는 이 구간이
 * "재연결해서 실행 중"인 화면을 관측할 수 있는 유일한 창이다.
 */
export const RECONNECT_HOLD_MS = 1_500;

export async function mockQueueReconnect(
  page: Page,
  options: { events: QueueEvent[]; holdMs?: number },
): Promise<void> {
  const holdMs = options.holdMs ?? RECONNECT_HOLD_MS;
  await page.route("**/api/bench/queue/*/reconnect", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    try {
      await route.fulfill({ contentType: "text/event-stream", body: sse(options.events) });
    } catch {
      // 창 안에서 단언이 끝나면 페이지가 먼저 닫힌다 — 목업이 늦게 응답하는 건 실패가 아니다.
    }
  });
}

/** `GET /api/runs/:runId` 응답(BenchRunDetailResponse) — 끝난 모델의 결과를 DB에서 되살릴 때 쓰인다. */
export function makeRunDetail(options: {
  runId: string;
  baseUrl: string;
  modelId: string;
  provider?: string;
  scenarios: ScenarioFixture[];
}) {
  const scenarios = options.scenarios.map(resolveScenario);
  return {
    meta: {
      run_id: options.runId,
      base_url: options.baseUrl,
      provider: options.provider ?? "lm_studio",
      model_id: options.modelId,
      created_at: "2026-01-01T00:00:00.000Z",
      api_routes: [...new Set(scenarios.map((s) => s.api))],
      scenario_ids: scenarios.map((s) => s.id),
    },
    scenarios: scenarios.map((sc) => ({
      id: sc.id,
      api_route: sc.api,
      prompt_system_preview: null,
      prompt_preview: `e2e prompt ${sc.id}`,
      runs: [
        {
          ttft_ms: sc.ttftMs,
          total_ms: sc.totalMs,
          output_text: sc.text,
          stream_completed: true,
          usage_output_tokens: sc.outputTokens,
          quality: { pass: true, score: 1 },
        },
      ],
    })),
  };
}

/**
 * `/api/runs*` 전부 — 핸들러 **하나**에서 URL로 분기한다.
 * 중첩해서 route를 여러 개 걸면 등록 순서(뒤에 건 것이 먼저)에 따라 latest-by-model이 상세 핸들러로
 * 새거나 그 반대가 되어 flake가 된다.
 */
export async function mockRunsApi(
  page: Page,
  options: { baseUrl: string; detailByRunId?: Record<string, unknown> },
): Promise<void> {
  const detailByRunId = options.detailByRunId ?? {};
  await page.route("**/api/runs**", (route) => {
    const { pathname } = new URL(route.request().url());
    // 사전 예상 시간 조회 — 기록 없음. items가 없으면 앱이 순회하다 터지므로 실제 응답 형태 그대로.
    if (pathname.endsWith("/api/runs/latest-by-model")) {
      return fulfillJson(route, { base_url: options.baseUrl, items: [], sqlite_available: true });
    }
    const detail = /\/api\/runs\/([^/]+)$/.exec(pathname);
    if (detail) {
      const found = detailByRunId[decodeURIComponent(detail[1])];
      if (!found) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return fulfillJson(route, found);
    }
    return fulfillJson(route, { runs: [], sqlite_available: true });
  });
}

// ---------------------------------------------------------------- 공용 유틸

/** axe의 color-contrast는 실행 중 트랜지션의 중간 합성색을 읽어 무작위로 실패한다 — 정착 후 스캔. */
export async function settleAnimations(page: Page): Promise<void> {
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(
      async (timeoutMs) =>
        void (await Promise.all(
          document.getAnimations().map((a) =>
            Promise.race([
              a.finished.catch(() => undefined),
              new Promise((resolve) => setTimeout(resolve, timeoutMs)),
            ]),
          ),
        )),
      1000,
    );
  }
}

/** 6단계 아코디언의 헤더 토글 버튼. */
export function stepButton(page: Page, n: number) {
  return page.locator(`#bench-step-${n} > div > h2 > button`);
}

/**
 * 6단계의 결과 표. 같은 단계 안 스코어보드도 `<table>`이고 예약 스켈레톤 행 모양까지 같아서,
 * sr-only caption으로 좁히지 않으면 두 표의 행이 섞인다.
 */
export function resultsTable(page: Page) {
  return page
    .locator("#bench-step-6-body table")
    .filter({ has: page.locator("caption", { hasText: /시나리오별 벤치 결과|Bench results by scenario/ }) });
}

export async function openStates(page: Page): Promise<string[]> {
  return Promise.all(
    [1, 2, 3, 4, 5, 6].map(async (n) => (await stepButton(page, n).getAttribute("aria-expanded")) ?? "?"),
  );
}
