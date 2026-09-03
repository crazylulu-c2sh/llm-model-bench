import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
// DB 경로를 임시로 고정(실데이터 무영향). tryOpenProdBenchDatabase는 최초 요청 때 열린다 —
// ESM import는 호이스팅되지만 DB 오픈이 지연 실행이라 이 시점 대입으로 충분하다(app.test.ts와 동일).
process.env.BENCH_DB_PATH = join(tmpdir(), `llm-bench-queuetest-${process.pid}.sqlite`);
import type { BenchQueueSnapshot, DetectResult } from "@llm-bench/shared";
import { createApp } from "./app.js";
import {
  _bufferedCountForTests,
  _resetBenchQueueRegistryForTests,
} from "./bench-queue-registry.js";
import { _resetLiveRunRegistryForTests } from "./bench-live-registry.js";
import { _resetRunControlRegistryForTests } from "./run-control.js";

/**
 * 서버 소유 벤치 큐(`POST /bench/queue` 계열)의 통합 테스트.
 *
 * 이 PR의 존재 이유는 "클라이언트가 사라져도 서버가 큐를 끝까지 돌린다"이므로, 여기서는
 * 라우트를 인프로세스로 부르고 업스트림(OpenAI 호환) 스트림을 **테스트가 손으로 붙잡아**
 * 런을 모델 경계에 고정한 채 큐의 관측 가능한 계약(SSE 이벤트 순서·스냅샷·409·404)을 못박는다.
 *
 * "아직 안 일어났다"를 단언할 때는 sleep을 쓰지 않는다 — 대신 **그보다 먼저 발행되는 이벤트**를
 * 동기점으로 쓴다. 예: 모델 경계 일시정지는 `queue_model_finished{index:i}`를 기다린 뒤
 * `queue_model_started{index:i+1}`의 부재를 본다(러너가 그 사이의 pause 게이트에 이미 걸려 있다).
 */

const app = createApp();
const req = (path: string, init?: RequestInit) => app.request(path, init);

const enc = new TextEncoder();
const originalFetch = globalThis.fetch;

// ── 업스트림 스텁: /v1/chat/completions 응답 스트림을 열어둔 채로 붙잡는다 ─────────────
// 스트림을 닫기 전까지 그 모델의 런은 끝나지 않으므로, 테스트가 "지금 모델 0을 돌고 있는 상태"를
// 원하는 만큼 유지하면서 재연결·정지·조회를 검사할 수 있다.
let held: Array<ReadableStreamDefaultController<Uint8Array>> = [];

function stubUpstream(): void {
  held = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/v1/chat/completions")) {
      let box!: ReadableStreamDefaultController<Uint8Array>;
      // start()는 생성자에서 동기 호출되므로 push 시점에 box는 이미 채워져 있다.
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          box = c;
        },
      });
      held.push(box);
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

/** 붙잡아 둔 n번째 업스트림 스트림을 정상 종료시켜 그 모델의 런을 끝낸다. */
function finishHeld(index: number): void {
  const c = held[index];
  if (!c) throw new Error(`업스트림 스트림 ${index}이(가) 아직 열리지 않았다`);
  c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"pong"}}]}\n\n'));
  c.enqueue(enc.encode("data: [DONE]\n\n"));
  c.close();
}

/** n번째 업스트림 호출이 도착할 때까지 기다린다(= 그 모델의 run_started가 이미 나갔다는 뜻). */
async function waitForUpstream(count: number): Promise<void> {
  await vi.waitFor(
    () => {
      expect(held.length).toBeGreaterThanOrEqual(count);
    },
    { timeout: 10_000, interval: 10 },
  );
}

// ── SSE 수집기 ──────────────────────────────────────────────────────────────────
type SseEvent = { type: string } & Record<string, unknown>;

type Collector = {
  events: SseEvent[];
  types: string[];
  /** 서버가 스트림을 닫으면(큐 종료) resolve. */
  done: Promise<void>;
  cancel(): Promise<void>;
};

function collectSse(resp: Response): Collector {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  const types: string[] = [];
  const done = (async () => {
    let buf = "";
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split("\n\n");
      buf = chunks.pop() ?? "";
      for (const chunk of chunks) {
        if (!chunk.startsWith("data: ")) continue; // ": ping" 등 SSE 주석 줄은 이벤트가 아니다
        const ev = JSON.parse(chunk.slice(6)) as SseEvent;
        events.push(ev);
        types.push(ev.type);
      }
    }
  })().catch(() => {
    // 구독 취소로 read가 깨지는 것은 정상 종료 경로다.
  });
  return { events, types, done, cancel: () => reader.cancel() };
}

const find = (c: Collector, type: string): SseEvent | undefined =>
  c.events.find((e) => e.type === type);

const hasModelStarted = (c: Collector, index: number): boolean =>
  c.events.some((e) => e.type === "queue_model_started" && e.index === index);

function waitForEvent(c: Collector, pred: (e: SseEvent) => boolean, timeout = 10_000) {
  return vi.waitFor(
    () => {
      expect(c.events.some(pred)).toBe(true);
    },
    { timeout, interval: 10 },
  );
}

// ── 요청 바디 ───────────────────────────────────────────────────────────────────
const detectFor = (baseUrl: string, modelIds: string[]): DetectResult => ({
  provider: "lm_studio",
  baseUrl,
  models: modelIds.map((id) => ({ id })),
  steps: [],
  capabilities: { openaiChat: true, anthropicMessages: false },
});

/** 시나리오 1개 · 워밍업 0 · 측정 1회 · 로드/가드 없음 — 결정적이고 빠른 최소 실행. */
const benchConfig = (baseUrl: string) => ({
  baseUrl,
  provider: "lm_studio" as const,
  scenarioIds: ["chat_ping"],
  warmupRuns: 0,
  measuredRuns: 1,
  skipModelLoad: true,
  unloadOtherModels: false,
  autoUnloadAfterBench: false,
  contentionGuardEnabled: false,
});

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const startQueue = (baseUrl: string, modelIds: string[]) =>
  req(
    "/api/bench/queue",
    jsonPost({ detect: detectFor(baseUrl, modelIds), bench: benchConfig(baseUrl), model_ids: modelIds }),
  );

const snapshotOf = async (queueId: string): Promise<BenchQueueSnapshot> => {
  const r = await req(`/api/bench/queue/${queueId}`);
  expect(r.status).toBe(200);
  return (await r.json()) as BenchQueueSnapshot;
};

/** queue_started에서 queue_id를 뽑는다 — 큐 생성 직후 핀되므로 최초 SSE의 첫 이벤트다. */
async function queueIdFrom(c: Collector): Promise<string> {
  await waitForEvent(c, (e) => e.type === "queue_started");
  return find(c, "queue_started")!.queue_id as string;
}

afterEach(async () => {
  // 남아 있는 업스트림을 모두 닫아 in-flight 런이 다음 테스트로 새지 않게 한다.
  for (const c of held) {
    try {
      c.close();
    } catch {
      // 이미 닫힘 — 무시
    }
  }
  held = [];
  globalThis.fetch = originalFetch;
  _resetBenchQueueRegistryForTests();
  _resetRunControlRegistryForTests();
  // 살아남은 라이브 런은 다음 테스트의 직렬 실행 락("run_active" 409)을 오염시킨다 —
  // 한 케이스가 깨졌을 때 뒤따르는 케이스까지 연쇄로 무너지지 않도록 여기서 함께 비운다.
  _resetLiveRunRegistryForTests();
});

/** 단발 실행(POST /bench/stream) 요청 바디 — 큐와 같은 최소 설정. */
const singleStreamBody = (baseUrl: string, modelId: string, benchBaseUrl = baseUrl) => ({
  detect: detectFor(baseUrl, [modelId]),
  bench: { ...benchConfig(benchBaseUrl), modelId },
});

describe("서버 소유 큐 — 클라이언트 생존과 무관한 실행", () => {
  it("★ 구독자가 사라져도 서버가 다음 모델을 시작한다(재연결 구독에 queue_model_started{index:1}이 온다)", async () => {
    stubUpstream();
    const baseUrl = "http://127.0.0.1:9101";
    const resp = await startQueue(baseUrl, ["queue-a-0", "queue-a-1"]);
    expect(resp.status).toBe(200);

    const first = collectSse(resp);
    const queueId = await queueIdFrom(first);
    await waitForUpstream(1);

    // 탭이 닫힌 상황 — 원 SSE 구독을 끊는다. 큐는 이것과 무관하게 계속 돈다.
    await first.cancel();

    const reconnect = await req(`/api/bench/queue/${queueId}/reconnect`);
    expect(reconnect.status).toBe(200);
    const live = collectSse(reconnect);
    await waitForEvent(live, (e) => e.type === "queue_model_started" && e.index === 0);

    // 모델 0의 업스트림을 끝낸다 → 서버가 스스로 모델 1로 넘어가야 한다.
    finishHeld(0);
    await waitForEvent(live, (e) => e.type === "queue_model_started" && e.index === 1);
    const started1 = live.events.find((e) => e.type === "queue_model_started" && e.index === 1)!;
    expect(started1.model_id).toBe("queue-a-1");

    await waitForUpstream(2);
    finishHeld(1);
    await waitForEvent(live, (e) => e.type === "queue_finished");
    expect(find(live, "queue_finished")!.status).toBe("finished");
  }, 20_000);

  it("재연결 replay는 queue_started → queue_model_started → run_started 순서로 시작한다", async () => {
    stubUpstream();
    const baseUrl = "http://127.0.0.1:9102";
    const resp = await startQueue(baseUrl, ["replay-0", "replay-1"]);
    const first = collectSse(resp);
    const queueId = await queueIdFrom(first);
    await waitForUpstream(1); // run_started가 이미 발행된 시점
    await first.cancel();

    const reconnect = await req(`/api/bench/queue/${queueId}/reconnect`);
    const live = collectSse(reconnect);
    await waitForEvent(live, (e) => e.type === "run_started");
    expect(live.types.slice(0, 3)).toEqual(["queue_started", "queue_model_started", "run_started"]);
    // run_started는 핀에서만 replay된다 — 버퍼에도 있으면 두 번 나간다.
    expect(live.types.filter((t) => t === "run_started")).toHaveLength(1);

    finishHeld(0);
    await waitForUpstream(2);
    finishHeld(1);
    await waitForEvent(live, (e) => e.type === "queue_finished");
  }, 20_000);
});

describe("서버 소유 큐 — 동시 실행 차단(409)", () => {
  it("같은 baseUrl에 큐가 이미 있으면 두 번째 POST /bench/queue는 409이고 실행도 시작되지 않는다", async () => {
    stubUpstream();
    const baseUrl = "http://127.0.0.1:9103";
    const resp = await startQueue(baseUrl, ["dup-0", "dup-1"]);
    const first = collectSse(resp);
    const queueId = await queueIdFrom(first);
    await waitForUpstream(1);

    const second = await startQueue(baseUrl, ["other-0", "other-1"]);
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string; queue: BenchQueueSnapshot };
    expect(body.error).toBe("queue_active");
    expect(body.queue.queue_id).toBe(queueId);

    // 두 번째 큐의 모델은 업스트림을 한 번도 부르지 않는다(= 실행이 시작되지 않았다).
    expect(held).toHaveLength(1);
    const running = (await (
      await req(`/api/bench/running?baseUrl=${encodeURIComponent(baseUrl)}`)
    ).json()) as { queues: BenchQueueSnapshot[] };
    expect(running.queues.filter((q) => q.status === "running")).toHaveLength(1);

    finishHeld(0);
    await waitForUpstream(2);
    finishHeld(1);
    await waitForEvent(first, (e) => e.type === "queue_finished");
  }, 20_000);

  it("큐 실행 중에는 POST /bench/stream도 409(queue_active) — 같은 GPU에 단발 실행이 겹치지 않는다", async () => {
    stubUpstream();
    const baseUrl = "http://127.0.0.1:9104";
    const resp = await startQueue(baseUrl, ["guard-0", "guard-1"]);
    const first = collectSse(resp);
    const queueId = await queueIdFrom(first);
    await waitForUpstream(1);

    const single = await req(
      "/api/bench/stream",
      jsonPost({
        detect: detectFor(baseUrl, ["single-model"]),
        bench: { ...benchConfig(baseUrl), modelId: "single-model" },
      }),
    );
    expect(single.status).toBe(409);
    const body = (await single.json()) as { error: string; queue_id: string; base_url: string };
    expect(body.error).toBe("queue_active");
    expect(body.queue_id).toBe(queueId);
    expect(body.base_url).toBe(baseUrl);
    expect(held).toHaveLength(1); // 단발 실행이 업스트림을 건드리지 않았다

    finishHeld(0);
    await waitForUpstream(2);
    finishHeld(1);
    await waitForEvent(first, (e) => e.type === "queue_finished");
  }, 20_000);

  it("★ 단발 런이 실행 중이면 큐 시작이 409 run_active로 거부되고, 그 런이 끝나면 통과한다", async () => {
    stubUpstream();
    const baseUrl = "http://127.0.0.1:9111";
    // 큐끼리만 배타적으로 두면 단발 런 위로 큐가 그대로 올라타 같은 GPU에서 벤치 두 건이 겹친다.
    const single = await req("/api/bench/stream", jsonPost(singleStreamBody(baseUrl, "solo-model")));
    expect(single.status).toBe(200);
    const soloSse = collectSse(single);
    await waitForEvent(soloSse, (e) => e.type === "run_started");
    const runId = find(soloSse, "run_started")!.run_id as string;
    await waitForUpstream(1);

    const blocked = await startQueue(baseUrl, ["afterrun-0"]);
    expect(blocked.status).toBe(409);
    const body = (await blocked.json()) as {
      error: string;
      base_url: string;
      run_id: string;
      model_id: string;
    };
    expect(body.error).toBe("run_active");
    expect(body.run_id).toBe(runId);
    expect(body.model_id).toBe("solo-model");
    expect(body.base_url).toBe(baseUrl);

    // 거부는 **실행 전에** 나야 한다 — 업스트림 호출도, 레지스트리의 큐도 늘지 않는다.
    expect(held).toHaveLength(1);
    const running = (await (
      await req(`/api/bench/running?baseUrl=${encodeURIComponent(baseUrl)}`)
    ).json()) as { queues: BenchQueueSnapshot[] };
    expect(running.queues).toHaveLength(0);

    // 락은 런과 함께 풀린다 — 같은 요청이 이번엔 200이어야 한다(영구 점유 회귀 방지).
    finishHeld(0);
    await soloSse.done;
    const allowed = await startQueue(baseUrl, ["afterrun-0"]);
    expect(allowed.status).toBe(200);
    const queueSse = collectSse(allowed);
    await queueIdFrom(queueSse);
    await waitForUpstream(2);
    finishHeld(1);
    await waitForEvent(queueSse, (e) => e.type === "queue_finished");
  }, 20_000);

  it("직렬 실행 락 키는 bench.baseUrl이 아니라 detect.baseUrl이다(실제 추론 대상)", async () => {
    stubUpstream();
    // runBench가 I/O에 쓰는 값은 detect.baseUrl이다. bench.baseUrl로 잠그면 두 필드가 갈라진
    // 요청이 같은 백엔드에 락을 두 개 만들어 벤치가 겹친다.
    const inferUrl = "http://127.0.0.1:9112";
    const first = await req(
      "/api/bench/queue",
      jsonPost({
        detect: detectFor(inferUrl, ["lockkey-0"]),
        bench: benchConfig("http://localhost:19112"),
        model_ids: ["lockkey-0"],
      }),
    );
    expect(first.status).toBe(200);
    const c = collectSse(first);
    const queueId = await queueIdFrom(c);
    await waitForUpstream(1);
    expect((await snapshotOf(queueId)).base_url).toBe(inferUrl);

    const second = await req(
      "/api/bench/queue",
      jsonPost({
        detect: detectFor(inferUrl, ["lockkey-1"]),
        bench: benchConfig("http://127.0.0.1:29112"),
        model_ids: ["lockkey-1"],
      }),
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string; queue: BenchQueueSnapshot };
    expect(body.error).toBe("queue_active");
    expect(body.queue.queue_id).toBe(queueId);
    expect(held).toHaveLength(1);

    // 단발 실행 쪽 가드도 같은 키를 써야 한다.
    const single = await req(
      "/api/bench/stream",
      jsonPost(singleStreamBody(inferUrl, "lockkey-intruder", "http://127.0.0.1:39112")),
    );
    expect(single.status).toBe(409);
    expect(((await single.json()) as { error: string }).error).toBe("queue_active");
    expect(held).toHaveLength(1);

    finishHeld(0);
    await waitForEvent(c, (e) => e.type === "queue_finished");
  }, 20_000);

  it("모델 경계(일시정지)에서는 /bench/stream 409의 model_id가 null이다", async () => {
    stubUpstream();
    const baseUrl = "http://127.0.0.1:9113";
    const resp = await startQueue(baseUrl, ["boundary-0", "boundary-1"]);
    const c = collectSse(resp);
    const queueId = await queueIdFrom(c);
    await waitForUpstream(1);

    // 모델이 실제로 돌고 있을 때는 그 모델을 보고한다.
    const during = await req("/api/bench/stream", jsonPost(singleStreamBody(baseUrl, "intruder")));
    expect(during.status).toBe(409);
    expect(((await during.json()) as { model_id: string | null }).model_id).toBe("boundary-0");

    // 일시정지 → 모델 0 종료 = 실행 중인 모델이 하나도 없는 모델 경계.
    expect((await req(`/api/bench/queue/${queueId}/pause`, { method: "POST" })).status).toBe(200);
    await waitForEvent(c, (e) => e.type === "queue_paused");
    finishHeld(0);
    await waitForEvent(c, (e) => e.type === "queue_model_finished" && e.index === 0);

    const atBoundary = await req(
      "/api/bench/stream",
      jsonPost(singleStreamBody(baseUrl, "intruder")),
    );
    expect(atBoundary.status).toBe(409);
    const body = (await atBoundary.json()) as { error: string; model_id: string | null };
    expect(body.error).toBe("queue_active");
    expect(
      body.model_id,
      "실행 중인 모델이 없는데 직전 모델을 '현재 실행 중'으로 보고했다",
    ).toBeNull();

    expect((await req(`/api/bench/queue/${queueId}/resume`, { method: "POST" })).status).toBe(200);
    await waitForUpstream(2);
    finishHeld(1);
    await waitForEvent(c, (e) => e.type === "queue_finished");
  }, 20_000);
});

describe("서버 소유 큐 — 조회 표면", () => {
  it("GET /bench/running이 실행 중 큐를 앞에 두고 pending 모델과 plan을 노출한다", async () => {
    stubUpstream();
    const baseUrl = "http://127.0.0.1:9105";

    // 먼저 큐 하나를 완주시켜 "완료 큐"를 만든다(TTL 안이라 목록에 남는다).
    const doneResp = await startQueue(baseUrl, ["listing-done"]);
    const doneQueue = collectSse(doneResp);
    await queueIdFrom(doneQueue);
    await waitForUpstream(1);
    finishHeld(0);
    await waitForEvent(doneQueue, (e) => e.type === "queue_finished");

    const liveResp = await startQueue(baseUrl, ["listing-live-0", "listing-live-1"]);
    const liveQueue = collectSse(liveResp);
    const liveId = await queueIdFrom(liveQueue);
    await waitForUpstream(2);

    const running = (await (
      await req(`/api/bench/running?baseUrl=${encodeURIComponent(baseUrl)}`)
    ).json()) as { runs: Array<{ run_id: string; queue_id: string | null }>; queues: BenchQueueSnapshot[] };
    expect(running.queues.length).toBeGreaterThanOrEqual(2);
    // 실행 중 큐가 항상 index 0 — 클라이언트가 queues[0]을 그대로 써도 안전해야 한다.
    expect(running.queues[0].queue_id).toBe(liveId);
    expect(running.queues[0].status).toBe("running");
    expect(running.queues[1].status).toBe("finished");

    const q = running.queues[0];
    expect(q.models.map((m) => m.model_id)).toEqual(["listing-live-0", "listing-live-1"]);
    expect(q.models[0].status).toBe("running");
    expect(q.models[1].status).toBe("pending"); // 아직 시작 전인 모델이 그대로 보인다
    expect(q.plan.scenario_ids).toEqual(["chat_ping"]);
    expect(q.plan.api_routes).toEqual(["chat_completions"]);
    expect(q.plan.warmup_runs).toBe(0);
    expect(q.plan.measured_runs).toBe(1);
    // 진행 중인 런은 자신이 속한 큐를 역참조할 수 있어야 한다.
    expect(running.runs.some((r) => r.queue_id === liveId)).toBe(true);

    finishHeld(1);
    await waitForUpstream(3);
    finishHeld(2);
    await waitForEvent(liveQueue, (e) => e.type === "queue_finished");
  }, 25_000);

  it("스냅샷의 run_id로 GET /runs/:runId가 200 — 완료 모델은 DB에서 복원된다", async () => {
    stubUpstream();
    const baseUrl = "http://127.0.0.1:9106";
    const resp = await startQueue(baseUrl, ["persist-0"]);
    const c = collectSse(resp);
    const queueId = await queueIdFrom(c);
    await waitForUpstream(1);
    finishHeld(0);
    await waitForEvent(c, (e) => e.type === "queue_finished");

    const snap = await snapshotOf(queueId);
    expect(snap.status).toBe("finished");
    const runId = snap.models[0].run_id;
    expect(runId).toBeTruthy();

    const detail = await req(`/api/runs/${runId}`);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { meta: { run_id: string; model_id: string } };
    expect(body.meta.run_id).toBe(runId);
    expect(body.meta.model_id).toBe("persist-0");
  }, 20_000);

  it("없는 queueId는 모두 404지만, 완료된 큐는 /reconnect만 404이고 스냅샷은 200이다", async () => {
    expect((await req("/api/bench/queue/no-such-queue")).status).toBe(404);
    expect((await req("/api/bench/queue/no-such-queue/reconnect")).status).toBe(404);
    expect((await req("/api/bench/queue/no-such-queue/pause", { method: "POST" })).status).toBe(404);
    expect((await req("/api/bench/queue/no-such-queue/resume", { method: "POST" })).status).toBe(404);
    expect((await req("/api/bench/queue/no-such-queue/stop", { method: "POST" })).status).toBe(404);

    stubUpstream();
    const baseUrl = "http://127.0.0.1:9107";
    const resp = await startQueue(baseUrl, ["finished-0"]);
    const c = collectSse(resp);
    const queueId = await queueIdFrom(c);
    await waitForUpstream(1);
    finishHeld(0);
    await waitForEvent(c, (e) => e.type === "queue_finished");

    // 완료 큐는 재연결 대상이 아니다 — 클라이언트는 스냅샷을 보고 DB 복원 경로를 탄다.
    expect((await req(`/api/bench/queue/${queueId}/reconnect`)).status).toBe(404);
    const snap = await snapshotOf(queueId);
    expect(snap.status).toBe("finished");
    expect(snap.current_run_id).toBeNull();
  }, 20_000);
});

describe("서버 소유 큐 — 정지·일시정지", () => {
  it("큐 정지는 다음 모델을 시작하지 않는다(queue_finished=cancelled, 남은 모델=cancelled)", async () => {
    stubUpstream();
    const baseUrl = "http://127.0.0.1:9108";
    const resp = await startQueue(baseUrl, ["stopq-0", "stopq-1"]);
    const c = collectSse(resp);
    const queueId = await queueIdFrom(c);
    await waitForUpstream(1);

    const stop = await req(`/api/bench/queue/${queueId}/stop`, { method: "POST" });
    expect(stop.status).toBe(200);

    // 진행 중이던 런을 끝내 준다 — 정지 판정은 그 다음 모델 경계에서 관측된다.
    finishHeld(0);
    await waitForEvent(c, (e) => e.type === "queue_finished");
    expect(hasModelStarted(c, 1)).toBe(false);
    expect(held).toHaveLength(1); // 두 번째 모델은 업스트림을 부르지도 않았다

    const finished = find(c, "queue_finished")!;
    expect(finished.status).toBe("cancelled");
    const snap = await snapshotOf(queueId);
    expect(snap.status).toBe("cancelled");
    expect(snap.models[1].status).toBe("cancelled");
  }, 20_000);

  it("런 단위 정지는 그 모델만 건너뛴다 — 큐는 다음 모델을 시작한다", async () => {
    stubUpstream();
    const baseUrl = "http://127.0.0.1:9109";
    const resp = await startQueue(baseUrl, ["skiprun-0", "skiprun-1"]);
    const c = collectSse(resp);
    const queueId = await queueIdFrom(c);
    await waitForUpstream(1);

    const runId = (await snapshotOf(queueId)).current_run_id;
    expect(runId).toBeTruthy();
    const stop = await req(`/api/bench/${runId}/stop`, { method: "POST" });
    expect(stop.status).toBe(200);

    finishHeld(0);
    // 런 정지는 "이 모델만 건너뛰기"다 — 큐 정지(POST /bench/queue/:id/stop)와 달리 다음 모델이 시작된다.
    // 둘 중 먼저 오는 쪽을 기다렸다가 판정한다 — 타임아웃으로 죽으면 어느 계약이 깨졌는지 안 보인다.
    await waitForEvent(
      c,
      (e) => (e.type === "queue_model_started" && e.index === 1) || e.type === "queue_finished",
    );
    expect(
      find(c, "queue_finished"),
      "런 단위 정지가 큐 전체를 끝냈다 — run_finished.reason==='cancelled'를 큐 정지로 승격하면 안 된다",
    ).toBeUndefined();
    expect(hasModelStarted(c, 1)).toBe(true);
    // 건너뛴 모델은 "완료"가 아니라 cancelled로 남아야 한다 — 여기가 비면 정지한 모델의
    // 부분 측정치가 정상 결과처럼 보고된다.
    const finished0 = c.events.find((e) => e.type === "queue_model_finished" && e.index === 0);
    expect(finished0, "queue_model_finished{index:0}이 발행되지 않았다").toBeDefined();
    expect(finished0!.status).toBe("cancelled");

    await waitForUpstream(2);
    finishHeld(1);
    await waitForEvent(c, (e) => e.type === "queue_finished");
    // 런 하나를 정지해도 큐 자체는 완주다(cancelled가 아니다).
    expect(find(c, "queue_finished")!.status).toBe("finished");
    const snap = await snapshotOf(queueId);
    expect(snap.status).toBe("finished");
    expect(snap.models.map((m) => m.status)).toEqual(["cancelled", "done"]);
  }, 20_000);

  it("★ 일시정지는 다음 모델의 시작을 실제로 막는다(모델 경계 게이트)", async () => {
    stubUpstream();
    const baseUrl = "http://127.0.0.1:9114";
    const resp = await startQueue(baseUrl, ["pausegate-0", "pausegate-1"]);
    const c = collectSse(resp);
    const queueId = await queueIdFrom(c);
    await waitForUpstream(1);

    // 모델 0의 업스트림을 닫기 **전에** 일시정지한다 — 모델 경계에 도달했을 때 게이트가 이미 서 있다.
    expect((await req(`/api/bench/queue/${queueId}/pause`, { method: "POST" })).status).toBe(200);
    await waitForEvent(c, (e) => e.type === "queue_paused");

    finishHeld(0);
    // queue_model_finished{0}은 다음 루프의 pause 게이트보다 **먼저** 발행된다. 이 이벤트를 본
    // 시점에 러너는 이미 waitWhileQueuePaused에 걸려 있으므로 sleep 없이 부재를 단언할 수 있다.
    await waitForEvent(c, (e) => e.type === "queue_model_finished" && e.index === 0);
    // 스냅샷을 먼저 본다 — markModelRunning은 queue_model_started 발행 **직전**에 index/status를
    // 옮기므로, 게이트가 없으면 SSE 도착을 기다릴 것도 없이 여기서 이미 index:1/running으로 보인다.
    const gated = await snapshotOf(queueId);
    expect(gated.paused).toBe(true);
    expect(gated.index, "일시정지 중인데 큐가 다음 모델로 넘어갔다 — pause 게이트가 없다").toBe(0);
    expect(gated.models[1].status).toBe("pending");
    expect(
      hasModelStarted(c, 1),
      "일시정지 중인데 다음 모델이 시작됐다 — 큐 러너의 pause 게이트가 없다",
    ).toBe(false);
    expect(held, "일시정지 중인데 다음 모델이 업스트림을 호출했다").toHaveLength(1);

    // 재개해야 비로소 다음 모델이 시작된다.
    expect((await req(`/api/bench/queue/${queueId}/resume`, { method: "POST" })).status).toBe(200);
    await waitForEvent(c, (e) => e.type === "queue_model_started" && e.index === 1);

    await waitForUpstream(2);
    finishHeld(1);
    await waitForEvent(c, (e) => e.type === "queue_finished");
    expect(find(c, "queue_finished")!.status).toBe("finished");
  }, 20_000);

  it("pause/resume이 스냅샷의 paused에 반영된다", async () => {
    stubUpstream();
    const baseUrl = "http://127.0.0.1:9110";
    const resp = await startQueue(baseUrl, ["pause-0", "pause-1"]);
    const c = collectSse(resp);
    const queueId = await queueIdFrom(c);
    await waitForUpstream(1);

    const paused = await req(`/api/bench/queue/${queueId}/pause`, { method: "POST" });
    expect(paused.status).toBe(200);
    expect((await snapshotOf(queueId)).paused).toBe(true);
    await waitForEvent(c, (e) => e.type === "queue_paused");

    const resumed = await req(`/api/bench/queue/${queueId}/resume`, { method: "POST" });
    expect(resumed.status).toBe(200);
    expect((await snapshotOf(queueId)).paused).toBe(false);
    await waitForEvent(c, (e) => e.type === "queue_resumed");

    finishHeld(0);
    await waitForUpstream(2);
    finishHeld(1);
    await waitForEvent(c, (e) => e.type === "queue_finished");
  }, 20_000);
});

describe("서버 소유 큐 — 자원 정리", () => {
  it("★ 큐가 완주하면 SSE keepalive 인터벌과 현재 모델 버퍼가 남지 않는다", async () => {
    stubUpstream();
    const baseUrl = "http://127.0.0.1:9115";
    // 실타이머 환경이라 "몇 개 남았나"를 세는 대신 **생성/해제 쌍**을 센다.
    // 소비자가 끊으면 cancel()이 오지만, 큐가 정상 완주해 서버가 close()하는 경로에는
    // cancel()이 오지 않는다 — 그쪽에서 정리를 빠뜨리면 SSE 한 건마다 15초 인터벌이 영원히 남는다.
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const resp = await startQueue(baseUrl, ["timer-0"]);
      const c = collectSse(resp);
      const queueId = await queueIdFrom(c);
      await waitForUpstream(1);
      finishHeld(0);
      await waitForEvent(c, (e) => e.type === "queue_finished");
      await c.done; // 서버가 스트림을 닫을 때까지 — 정리는 그 경로에서 돈다

      const keepaliveHandles = setSpy.mock.calls
        .map((args, i) => ({ ms: args[1] as number | undefined, handle: setSpy.mock.results[i]?.value as unknown }))
        .filter((t) => t.ms === 15_000)
        .map((t) => t.handle);
      expect(
        keepaliveHandles.length,
        "keepalive 인터벌이 하나도 안 잡혔다 — 계수 방식이 구현과 어긋났다",
      ).toBeGreaterThanOrEqual(1);
      const cleared = new Set<unknown>(clearSpy.mock.calls.map((args) => args[0] as unknown));
      expect(
        keepaliveHandles.filter((h) => !cleared.has(h)),
        "정상 완주 경로에서 keepalive 인터벌이 정리되지 않았다(cancel()에만 teardown을 걸면 샌다)",
      ).toHaveLength(0);

      // 완료 큐는 재연결 대상이 아니다 — 현재 모델 버퍼도 즉시 반납해야 한다.
      expect(_bufferedCountForTests(queueId)).toBe(0);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  }, 20_000);
});
