import { afterEach, describe, expect, it, vi } from "vitest";
import type { BenchQueuePlan, BenchQueueStreamEvent, BenchRunMeta } from "@llm-bench/shared";
import {
  _bufferedCountForTests,
  _resetBenchQueueRegistryForTests,
  activeQueueForBaseUrl,
  createQueue,
  finishQueue,
  getQueueSnapshot,
  isQueueStopRequested,
  listQueues,
  markModelFinished,
  markModelRunId,
  markModelRunning,
  markRemainingCancelled,
  pauseQueue,
  publishQueueEvent,
  requestQueueStop,
  resumeQueue,
  subscribeToQueue,
  waitWhileQueuePaused,
} from "./bench-queue-registry.js";
import {
  _resetRunControlRegistryForTests,
  isRunCancelled,
  isRunPaused,
  registerRunControl,
} from "./run-control.js";

/**
 * 서버 소유 큐 레지스트리의 순수 단위 테스트. 여기서 지키려는 계약 두 가지:
 *  1) replay 순서(queue_started → queue_model_started → run_started → 현재 모델 버퍼)와
 *     모델 경계에서의 버퍼 리셋 — 재연결한 탭이 "지금 어느 모델인지"를 잃지 않기 위한 전부다.
 *  2) 일시정지 권위가 큐 하나에 모여 있는지 — 큐 플래그와 런 플래그가 갈라지면 UI는 재개인데
 *     다음 모델이 안 도는 관측 불가 상태가 된다.
 */

afterEach(() => {
  _resetBenchQueueRegistryForTests();
  _resetRunControlRegistryForTests();
  vi.useRealTimers();
});

const BASE = "http://127.0.0.1:1234";
const OTHER_BASE = "http://127.0.0.1:11434";

const PLAN: BenchQueuePlan = {
  scenario_ids: ["chat_hello"],
  api_routes: ["chat_completions"],
  warmup_runs: 1,
  measured_runs: 3,
};

function makeQueue(queueId: string, modelIds: string[] = ["m1", "m2"], baseUrl = BASE) {
  return createQueue({ queueId, baseUrl, provider: "lm_studio", modelIds, plan: PLAN });
}

function meta(runId: string, modelId: string): BenchRunMeta {
  return {
    run_id: runId,
    base_url: BASE,
    provider: "lm_studio",
    model_id: modelId,
    api_routes: ["chat_completions"],
    scenario_ids: ["chat_hello"],
    scenario_bundle_version: "4",
    temperature: 0.2,
    max_tokens: 512,
    parallel: false,
    warmup_runs: 1,
    measured_runs: 3,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

const queueStarted = (queueId: string, modelIds: string[]): BenchQueueStreamEvent => ({
  type: "queue_started",
  queue_id: queueId,
  base_url: BASE,
  provider: "lm_studio",
  model_ids: modelIds,
  plan: PLAN,
});

const modelStarted = (queueId: string, index: number, modelId: string): BenchQueueStreamEvent => ({
  type: "queue_model_started",
  queue_id: queueId,
  index,
  model_id: modelId,
});

const runStarted = (runId: string, modelId: string): BenchQueueStreamEvent => ({
  type: "run_started",
  run_id: runId,
  meta: meta(runId, modelId),
});

// ------------------------------------------------------------------ 스냅샷 · 조회

describe("bench-queue-registry 스냅샷 조회", () => {
  it("createQueue는 모든 모델이 pending인 running 스냅샷을 만든다", () => {
    const snap = makeQueue("q1", ["m1", "m2"]);
    expect(snap.queue_id).toBe("q1");
    expect(snap.status).toBe("running");
    expect(snap.index).toBe(0);
    expect(snap.paused).toBe(false);
    expect(snap.current_run_id).toBeNull();
    expect(snap.plan).toEqual(PLAN);
    expect(snap.models).toEqual([
      { model_id: "m1", status: "pending", run_id: null, started_at: null, finished_at: null, error_count: 0 },
      { model_id: "m2", status: "pending", run_id: null, started_at: null, finished_at: null, error_count: 0 },
    ]);
    expect(getQueueSnapshot("q1")).toEqual(snap);
  });

  it("getQueueSnapshot은 모르는 큐에 null을 준다", () => {
    expect(getQueueSnapshot("nope")).toBeNull();
  });

  it("listQueues는 baseUrl로 거른다", () => {
    makeQueue("q1", ["m1"], BASE);
    makeQueue("q2", ["m2"], OTHER_BASE);
    expect(listQueues().map((q) => q.queue_id).sort()).toEqual(["q1", "q2"]);
    expect(listQueues(BASE).map((q) => q.queue_id)).toEqual(["q1"]);
    expect(listQueues(OTHER_BASE).map((q) => q.queue_id)).toEqual(["q2"]);
    expect(listQueues("http://nope")).toEqual([]);
  });

  it("실행 중 큐가 완료 큐보다 앞이고, 완료 큐끼리는 finished_at 내림차순이다", () => {
    // 삽입 순서를 일부러 뒤집어 만든다 — 서버가 정렬 책임을 지지 않으면 queues[0]이 옛 큐가 된다.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(1_000);
    makeQueue("old", ["m1"]);
    finishQueue("old", "finished");
    vi.setSystemTime(2_000);
    makeQueue("recent", ["m1"]);
    finishQueue("recent", "finished");
    vi.setSystemTime(3_000);
    makeQueue("live", ["m1"]);

    expect(listQueues().map((q) => q.queue_id)).toEqual(["live", "recent", "old"]);
  });
});

describe("activeQueueForBaseUrl", () => {
  it("같은 base_url의 실행 중 큐를 찾는다", () => {
    makeQueue("q1", ["m1"], BASE);
    expect(activeQueueForBaseUrl(BASE)?.queue_id).toBe("q1");
  });

  it("다른 base_url의 큐는 찾지 않는다", () => {
    makeQueue("q1", ["m1"], OTHER_BASE);
    expect(activeQueueForBaseUrl(BASE)).toBeNull();
  });

  it("완료된 큐는 찾지 않는다 — 같은 서버에 새 큐를 열 수 있어야 한다", () => {
    makeQueue("q1", ["m1"], BASE);
    finishQueue("q1", "finished");
    expect(activeQueueForBaseUrl(BASE)).toBeNull();
  });
});

// ------------------------------------------------------------------ 모델 진행 표시

describe("모델 진행 마킹", () => {
  it("markModelRunning/RunId/Finished가 index·status·run_id·error_count를 갱신한다", () => {
    makeQueue("q1", ["m1", "m2"]);

    markModelRunning("q1", 0);
    let snap = getQueueSnapshot("q1")!;
    expect(snap.index).toBe(0);
    expect(snap.models[0]?.status).toBe("running");
    expect(snap.models[0]?.started_at).not.toBeNull();
    expect(snap.current_run_id).toBeNull(); // run_started 전엔 아직 모른다

    markModelRunId("q1", 0, "run-1");
    snap = getQueueSnapshot("q1")!;
    expect(snap.models[0]?.run_id).toBe("run-1");
    expect(snap.current_run_id).toBe("run-1");

    markModelFinished("q1", 0, { status: "done-with-errors", errorCount: 2 });
    snap = getQueueSnapshot("q1")!;
    expect(snap.models[0]?.status).toBe("done-with-errors");
    expect(snap.models[0]?.error_count).toBe(2);
    expect(snap.models[0]?.finished_at).not.toBeNull();
    expect(snap.models[0]?.run_id).toBe("run-1"); // DB 복원 키는 남는다
    expect(snap.current_run_id).toBeNull();

    markModelRunning("q1", 1);
    expect(getQueueSnapshot("q1")!.index).toBe(1);
  });

  it("markRemainingCancelled는 pending 모델만 cancelled로 바꾼다", () => {
    makeQueue("q1", ["m1", "m2", "m3"]);
    markModelRunning("q1", 0);
    markModelFinished("q1", 0, { status: "done", errorCount: 0 });

    markRemainingCancelled("q1", 1);
    expect(getQueueSnapshot("q1")!.models.map((m) => m.status)).toEqual([
      "done",
      "cancelled",
      "cancelled",
    ]);
  });

  it("모르는 큐·범위 밖 index에 대한 마킹은 조용히 무시된다", () => {
    makeQueue("q1", ["m1"]);
    expect(() => markModelRunning("nope", 0)).not.toThrow();
    expect(() => markModelRunning("q1", 7)).not.toThrow();
    expect(getQueueSnapshot("q1")!.models[0]?.status).toBe("pending");
  });
});

/**
 * 러너(`bench-queue-runner.ts`)의 catch 경로가 의존하는 레지스트리 계약.
 * 드라이버 밖에서 예외가 터지면 러너는 `markModelFinished(status:"failed")` +
 * `markRemainingCancelled(current + 1)`을 부르고 큐를 "cancelled"로 닫는다 —
 * 그 조합이 실제로 running/pending을 하나도 남기지 않는지가 여기서 고정된다.
 */
describe("러너 예외 경로의 레지스트리 계약", () => {
  it("진행 중 모델은 failed, 남은 모델은 cancelled로 굳는다", () => {
    makeQueue("q1", ["m1", "m2", "m3"]);
    markModelRunning("q1", 0);
    markModelRunId("q1", 0, "run-1");

    // 러너 catch가 하는 일 그대로.
    markModelFinished("q1", 0, { status: "failed", errorCount: 1 });
    markRemainingCancelled("q1", 1);

    const snap = getQueueSnapshot("q1")!;
    expect(snap.models.map((m) => m.status)).toEqual(["failed", "cancelled", "cancelled"]);
    expect(snap.models[0]?.error_count).toBe(1);
    expect(snap.models[0]?.finished_at).not.toBeNull();
    expect(snap.models[0]?.run_id).toBe("run-1"); // 부분 결과 DB 복원 키는 남는다
    expect(snap.current_run_id).toBeNull();
    // running/pending이 하나라도 남으면 UI가 영원히 스피너를 돈다.
    expect(snap.models.some((m) => m.status === "running" || m.status === "pending")).toBe(false);
  });

  it("중간 모델에서 터져도 앞서 끝난 모델의 결과는 보존된다", () => {
    makeQueue("q1", ["m1", "m2", "m3"]);
    markModelRunning("q1", 0);
    markModelRunId("q1", 0, "run-1");
    markModelFinished("q1", 0, { status: "done-with-errors", errorCount: 2 });
    markModelRunning("q1", 1);
    markModelRunId("q1", 1, "run-2");

    markModelFinished("q1", 1, { status: "failed", errorCount: 1 });
    markRemainingCancelled("q1", 2);

    const snap = getQueueSnapshot("q1")!;
    expect(snap.models.map((m) => m.status)).toEqual(["done-with-errors", "failed", "cancelled"]);
    expect(snap.models[0]?.error_count).toBe(2);
    expect(snap.models[0]?.run_id).toBe("run-1");
    expect(snap.models[1]?.run_id).toBe("run-2");
  });

  it("finishQueue('cancelled')로 닫아도 모델별 실패·중지 표시는 남는다", () => {
    makeQueue("q1", ["m1", "m2"]);
    markModelRunning("q1", 0);
    markModelRunId("q1", 0, "run-1");
    markModelFinished("q1", 0, { status: "failed", errorCount: 1 });
    markRemainingCancelled("q1", 1);
    finishQueue("q1", "cancelled");

    const snap = getQueueSnapshot("q1")!;
    expect(snap.status).toBe("cancelled");
    expect(snap.models.map((m) => m.status)).toEqual(["failed", "cancelled"]);
    expect(snap.index).toBe(snap.models.length);
  });
});

// ------------------------------------------------------------------ 핀 · 버퍼 계약

describe("핀·버퍼 계약", () => {
  it("replay 순서는 queue_started → queue_model_started → run_started → 현재 모델 버퍼다", () => {
    makeQueue("q1", ["m1", "m2"]);
    const qs = queueStarted("q1", ["m1", "m2"]);
    const ms = modelStarted("q1", 0, "m1");
    const rs = runStarted("run-1", "m1");
    const loaded: BenchQueueStreamEvent = {
      type: "model_loaded",
      model_id: "m1",
      provider: "lm_studio",
    };
    publishQueueEvent("q1", qs);
    publishQueueEvent("q1", ms);
    publishQueueEvent("q1", rs);
    publishQueueEvent("q1", loaded);
    publishQueueEvent("q1", { type: "token_delta", scenario_id: "chat_hello", text: "hi" });

    // 이벤트를 다 흘린 **뒤** 구독해도(=새로고침한 탭) 순서가 그대로인지가 핵심이다.
    expect(subscribeToQueue("q1")!.bufferedEvents).toEqual([qs, ms, rs, loaded]);
  });

  it("핀 셋은 링버퍼 축출을 견딘다", () => {
    makeQueue("q1", ["m1"]);
    const qs = queueStarted("q1", ["m1"]);
    const ms = modelStarted("q1", 0, "m1");
    const rs = runStarted("run-1", "m1");
    publishQueueEvent("q1", qs);
    publishQueueEvent("q1", ms);
    publishQueueEvent("q1", rs);
    for (let i = 0; i < 600; i++) {
      publishQueueEvent("q1", {
        type: "contention_waiting",
        phase: "pre_bench",
        waiting_reason: "gpu_busy",
        reasons: ["gpu_busy"],
        gpu_signal_available: true,
        elapsed_ms: i,
      });
    }

    const replay = subscribeToQueue("q1")!.bufferedEvents;
    expect(replay.slice(0, 3)).toEqual([qs, ms, rs]);
    expect(replay.filter((ev) => ev.type === "queue_started")).toHaveLength(1);
    expect(replay.filter((ev) => ev.type === "run_started")).toHaveLength(1);
  });

  it("모델 경계에서 버퍼가 리셋되고 이전 모델 이벤트는 하나도 남지 않는다", () => {
    makeQueue("q1", ["m1", "m2"]);
    const qs = queueStarted("q1", ["m1", "m2"]);
    publishQueueEvent("q1", qs);
    publishQueueEvent("q1", modelStarted("q1", 0, "m1"));
    publishQueueEvent("q1", runStarted("run-1", "m1"));
    publishQueueEvent("q1", { type: "model_loaded", model_id: "m1", provider: "lm_studio" });
    publishQueueEvent("q1", {
      type: "queue_model_finished",
      queue_id: "q1",
      index: 0,
      model_id: "m1",
      run_id: "run-1",
      status: "done",
      error_count: 0,
    });

    const ms2 = modelStarted("q1", 1, "m2");
    const rs2 = runStarted("run-2", "m2");
    publishQueueEvent("q1", ms2);
    publishQueueEvent("q1", rs2);

    const replay = subscribeToQueue("q1")!.bufferedEvents;
    expect(replay).toEqual([qs, ms2, rs2]);
    // 첫 모델의 흔적이 하나도 없어야 한다 — 남으면 재연결 탭이 끝난 모델을 진행 중으로 그린다.
    expect(JSON.stringify(replay)).not.toContain("run-1");
    expect(replay.some((ev) => ev.type === "model_loaded")).toBe(false);
    expect(replay.some((ev) => ev.type === "queue_model_finished")).toBe(false);
    expect(replay.some((ev) => ev.type === "run_started" && ev.run_id === "run-2")).toBe(true);
  });

  it("두 번째 run_started는 현재 모델의 핀을 덮어쓰지 않는다", () => {
    makeQueue("q1", ["m1"]);
    const rs = runStarted("run-1", "m1");
    publishQueueEvent("q1", modelStarted("q1", 0, "m1"));
    publishQueueEvent("q1", rs);
    publishQueueEvent("q1", runStarted("run-1-dup", "m1"));

    const replay = subscribeToQueue("q1")!.bufferedEvents;
    expect(replay[1]).toEqual(rs);
  });

  it("모르는 큐로의 publish는 조용히 무시된다", () => {
    expect(() => publishQueueEvent("nope", queueStarted("nope", ["m1"]))).not.toThrow();
  });
});

/**
 * 위 계약들은 replay 배열만 보므로 "버퍼가 실제로 비었는지"는 못 본다 —
 * 핀만 남기고 버퍼는 무한히 자라는 구현도 replay 단언을 통과한다.
 * 여기서는 `_bufferedCountForTests`로 메모리 자체를 관측한다.
 */
describe("버퍼 길이 관측", () => {
  const contention = (elapsedMs: number): BenchQueueStreamEvent => ({
    type: "contention_waiting",
    phase: "pre_bench",
    waiting_reason: "gpu_busy",
    reasons: ["gpu_busy"],
    gpu_signal_available: true,
    elapsed_ms: elapsedMs,
  });

  it("핀·token_delta는 버퍼를 늘리지 않고 나머지 이벤트만 쌓인다", () => {
    makeQueue("q1", ["m1", "m2"]);
    expect(_bufferedCountForTests("q1")).toBe(0);

    publishQueueEvent("q1", queueStarted("q1", ["m1", "m2"]));
    publishQueueEvent("q1", modelStarted("q1", 0, "m1"));
    publishQueueEvent("q1", runStarted("run-1", "m1"));
    // 셋 다 핀으로 가므로 버퍼는 여전히 비어 있어야 한다(중복 보관 금지).
    expect(_bufferedCountForTests("q1")).toBe(0);

    publishQueueEvent("q1", { type: "model_loaded", model_id: "m1", provider: "lm_studio" });
    expect(_bufferedCountForTests("q1")).toBe(1);
    publishQueueEvent("q1", contention(1));
    expect(_bufferedCountForTests("q1")).toBe(2);

    // token_delta는 라이브로만 흐른다 — 쌓으면 토큰 하나에 한 칸씩 메모리를 먹는다.
    publishQueueEvent("q1", { type: "token_delta", scenario_id: "chat_hello", text: "hi" });
    expect(_bufferedCountForTests("q1")).toBe(2);
  });

  it("queue_model_started는 버퍼를 0으로 리셋한다", () => {
    makeQueue("q1", ["m1", "m2"]);
    publishQueueEvent("q1", modelStarted("q1", 0, "m1"));
    for (let i = 0; i < 5; i++) publishQueueEvent("q1", contention(i));
    expect(_bufferedCountForTests("q1")).toBe(5);

    publishQueueEvent("q1", modelStarted("q1", 1, "m2"));
    expect(_bufferedCountForTests("q1")).toBe(0);

    // 리셋 뒤 새 모델의 이벤트는 정상적으로 다시 쌓인다.
    publishQueueEvent("q1", contention(99));
    expect(_bufferedCountForTests("q1")).toBe(1);
  });

  it("링버퍼는 상한(500)을 넘지 않고 오래된 것부터 밀려난다", () => {
    makeQueue("q1", ["m1"]);
    publishQueueEvent("q1", modelStarted("q1", 0, "m1"));
    for (let i = 0; i < 700; i++) publishQueueEvent("q1", contention(i));

    expect(_bufferedCountForTests("q1")).toBe(500);
    const replay = subscribeToQueue("q1")!.bufferedEvents;
    expect(replay).toHaveLength(501); // 핀(queue_model_started) 1건 + 버퍼 500건
    const kept = replay.filter(
      (ev): ev is Extract<BenchQueueStreamEvent, { type: "contention_waiting" }> =>
        ev.type === "contention_waiting",
    );
    expect(kept).toHaveLength(500);
    expect(kept[0]?.elapsed_ms).toBe(200); // 0~199는 축출됐다
    expect(kept.at(-1)?.elapsed_ms).toBe(699);
  });

  it("finishQueue는 버퍼를 실제로 0으로 되돌린다", () => {
    makeQueue("q1", ["m1"]);
    publishQueueEvent("q1", modelStarted("q1", 0, "m1"));
    for (let i = 0; i < 10; i++) publishQueueEvent("q1", contention(i));
    expect(_bufferedCountForTests("q1")).toBe(10);

    finishQueue("q1", "finished");
    // 완료 큐는 30분간 스냅샷으로 남지만 이벤트 메모리는 붙들고 있으면 안 된다.
    expect(getQueueSnapshot("q1")).not.toBeNull();
    expect(_bufferedCountForTests("q1")).toBe(0);
  });

  it("모르는 큐는 null이다", () => {
    expect(_bufferedCountForTests("nope")).toBeNull();
  });
});

// ------------------------------------------------------------------ 구독

describe("subscribeToQueue", () => {
  it("여러 구독자가 같은 이벤트를 동시에 받는다", () => {
    makeQueue("q1", ["m1"]);
    const subA = subscribeToQueue("q1")!;
    const subB = subscribeToQueue("q1")!;
    const gotA: BenchQueueStreamEvent[] = [];
    const gotB: BenchQueueStreamEvent[] = [];
    subA.onEvent((ev) => gotA.push(ev));
    subB.onEvent((ev) => gotB.push(ev));

    const ev = modelStarted("q1", 0, "m1");
    publishQueueEvent("q1", ev);
    expect(gotA).toEqual([ev]);
    expect(gotB).toEqual([ev]);

    // token_delta는 버퍼링하지 않지만 라이브로는 흘러야 한다.
    const delta: BenchQueueStreamEvent = {
      type: "token_delta",
      scenario_id: "chat_hello",
      text: "hi",
    };
    publishQueueEvent("q1", delta);
    expect(gotA).toEqual([ev, delta]);
  });

  it("unsubscribe 후에는 더 받지 않는다", () => {
    makeQueue("q1", ["m1"]);
    const sub = subscribeToQueue("q1")!;
    const got: BenchQueueStreamEvent[] = [];
    sub.onEvent((ev) => got.push(ev));
    publishQueueEvent("q1", modelStarted("q1", 0, "m1"));
    sub.unsubscribe();
    publishQueueEvent("q1", modelStarted("q1", 1, "m2"));
    expect(got).toHaveLength(1);
  });

  it("모르는 큐는 null을 준다", () => {
    expect(subscribeToQueue("nope")).toBeNull();
  });
});

// ------------------------------------------------------------------ 종료

describe("finishQueue", () => {
  it("스냅샷을 종료 상태로 만들고 onDone을 발화한다", () => {
    makeQueue("q1", ["m1", "m2"]);
    markModelRunning("q1", 0);
    markModelRunId("q1", 0, "run-1");
    publishQueueEvent("q1", queueStarted("q1", ["m1", "m2"]));

    const sub = subscribeToQueue("q1")!;
    let done = false;
    sub.onDone(() => {
      done = true;
    });

    finishQueue("q1", "finished");

    const snap = getQueueSnapshot("q1")!;
    expect(done).toBe(true);
    expect(snap.status).toBe("finished");
    expect(snap.finished_at).not.toBeNull();
    expect(snap.paused).toBe(false);
    expect(snap.current_run_id).toBeNull(); // 죽은 run_id로 재연결해 404를 맞으면 안 된다
    expect(snap.index).toBe(snap.models.length);
  });

  it("완료 큐는 재연결 대상이 아니다(버퍼 해제 + subscribeToQueue null)", () => {
    makeQueue("q1", ["m1"]);
    publishQueueEvent("q1", queueStarted("q1", ["m1"]));
    publishQueueEvent("q1", modelStarted("q1", 0, "m1"));
    publishQueueEvent("q1", { type: "model_loaded", model_id: "m1", provider: "lm_studio" });
    expect(_bufferedCountForTests("q1")).toBe(1);

    finishQueue("q1", "cancelled");

    expect(getQueueSnapshot("q1")!.status).toBe("cancelled");
    expect(_bufferedCountForTests("q1")).toBe(0); // 핀만이 아니라 버퍼도 실제로 비워야 한다
    expect(subscribeToQueue("q1")).toBeNull();
  });

  it("완료 후 publish는 버퍼에 쌓이지 않는다", () => {
    makeQueue("q1", ["m1"]);
    const sub = subscribeToQueue("q1")!;
    const got: BenchQueueStreamEvent[] = [];
    sub.onEvent((ev) => got.push(ev));
    finishQueue("q1", "finished");
    publishQueueEvent("q1", { type: "run_finished", run_id: "run-1" });
    // 라이브 구독자에게는 흘러가되(스트림을 아직 닫는 중일 수 있다) 메모리에는 남지 않는다.
    expect(got).toHaveLength(1);
    expect(_bufferedCountForTests("q1")).toBe(0);
    expect(subscribeToQueue("q1")).toBeNull();
  });
});

// ------------------------------------------------------------------ 보존 정책

describe("보존 정책", () => {
  it("완료 큐는 TTL(30분)이 지나면 조회 시점에 쓸려나간다", () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    makeQueue("q1", ["m1"]);
    finishQueue("q1", "finished");
    expect(getQueueSnapshot("q1")).not.toBeNull();

    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    expect(getQueueSnapshot("q1")).toBeNull();
    expect(listQueues()).toEqual([]);
  });

  it("실행 중 큐는 TTL이 지나도 살아있다", () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    makeQueue("q1", ["m1"]);

    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    expect(getQueueSnapshot("q1")?.status).toBe("running");
  });

  it("보존 상한을 넘으면 오래된 완료 큐부터 축출되고 실행 중 큐는 남는다", () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(1_000_000);
    makeQueue("live", ["m1"]); // 가장 오래됐지만 running이므로 절대 축출 대상이 아니다
    for (let i = 0; i < 25; i++) {
      vi.setSystemTime(1_000_000 + i * 1000);
      makeQueue(`q${i}`, ["m1"]);
      finishQueue(`q${i}`, "finished");
    }

    const ids = listQueues().map((q) => q.queue_id);
    expect(ids).toContain("live");
    expect(ids.filter((id) => id !== "live")).toHaveLength(20);
    expect(ids).not.toContain("q0");
    expect(ids).not.toContain("q4");
    expect(ids).toContain("q24");
  });
});

// ------------------------------------------------------------------ 일시정지 · 정지

describe("pause/resume/stop 의미론", () => {
  it("모델 경계(current_run_id 없음)에서의 pause도 성공한다", () => {
    // 회귀 방지: 런에 위임한 결과를 HTTP 상태로 쓰면 모델 사이에 누른 일시정지가 404가 된다.
    makeQueue("q1", ["m1", "m2"]);
    const sub = subscribeToQueue("q1")!;
    const got: BenchQueueStreamEvent[] = [];
    sub.onEvent((ev) => got.push(ev));

    expect(getQueueSnapshot("q1")!.current_run_id).toBeNull();
    expect(pauseQueue("q1")).toBe(true);
    expect(getQueueSnapshot("q1")!.paused).toBe(true);
    expect(got.map((ev) => ev.type)).toEqual(["queue_paused"]);
  });

  it("pause/resume는 queue_paused/queue_resumed를 정확히 한 번씩 낸다", () => {
    makeQueue("q1", ["m1"]);
    const sub = subscribeToQueue("q1")!;
    const got: BenchQueueStreamEvent[] = [];
    sub.onEvent((ev) => got.push(ev));

    expect(pauseQueue("q1")).toBe(true);
    expect(pauseQueue("q1")).toBe(true); // 중복 pause는 이벤트를 내지 않는다
    expect(resumeQueue("q1")).toBe(true);
    expect(resumeQueue("q1")).toBe(true); // 중복 resume도 마찬가지

    expect(got.map((ev) => ev.type)).toEqual(["queue_paused", "queue_resumed"]);
    expect(getQueueSnapshot("q1")!.paused).toBe(false);
  });

  it("진행 중인 런이 있으면 pause/resume를 런에도 위임한다", () => {
    makeQueue("q1", ["m1"]);
    markModelRunning("q1", 0);
    markModelRunId("q1", 0, "run-1");
    registerRunControl("run-1");

    pauseQueue("q1");
    expect(isRunPaused("run-1")).toBe(true);
    resumeQueue("q1");
    expect(isRunPaused("run-1")).toBe(false);
  });

  it("큐 pause 30분 자동 재개는 런 플래그도 함께 푼다", async () => {
    vi.useFakeTimers();
    makeQueue("q1", ["m1"]);
    markModelRunning("q1", 0);
    markModelRunId("q1", 0, "run-1");
    registerRunControl("run-1");
    const sub = subscribeToQueue("q1")!;
    const got: BenchQueueStreamEvent[] = [];
    sub.onEvent((ev) => got.push(ev));

    pauseQueue("q1");
    expect(isRunPaused("run-1")).toBe(true);

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);

    // 자동 재개가 resume 라우트와 같은 함수를 타야 큐·런 플래그가 함께 풀린다.
    expect(getQueueSnapshot("q1")!.paused).toBe(false);
    expect(isRunPaused("run-1")).toBe(false);
    expect(got.map((ev) => ev.type)).toEqual(["queue_paused", "queue_resumed"]);
  });

  it("waitWhileQueuePaused는 일시정지가 아니면 즉시 resolve한다", async () => {
    makeQueue("q1", ["m1"]);
    await expect(waitWhileQueuePaused("q1")).resolves.toBeUndefined();
    await expect(waitWhileQueuePaused("nope")).resolves.toBeUndefined();
  });

  it("재개는 일시정지 대기 중인 큐를 깨운다", async () => {
    makeQueue("q1", ["m1"]);
    pauseQueue("q1");
    const waiter = waitWhileQueuePaused("q1");
    let resolved = false;
    void waiter.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    resumeQueue("q1");
    await waiter;
    expect(resolved).toBe(true);
  });

  it("정지는 일시정지 대기 중인 큐를 즉시 깨운다", async () => {
    // 안 깨우면 "일시정지 중 정지"가 최대 30분 뒤에야 먹는다.
    makeQueue("q1", ["m1"]);
    markModelRunning("q1", 0);
    markModelRunId("q1", 0, "run-1");
    registerRunControl("run-1");
    pauseQueue("q1");

    const waiter = waitWhileQueuePaused("q1");
    let resolved = false;
    void waiter.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    expect(requestQueueStop("q1")).toBe(true);
    await waiter;
    expect(resolved).toBe(true);
    expect(isQueueStopRequested("q1")).toBe(true);
    expect(getQueueSnapshot("q1")!.paused).toBe(false);
    expect(isRunCancelled("run-1")).toBe(true);
  });

  it("정지된 큐는 pause를 무시한다", () => {
    makeQueue("q1", ["m1"]);
    const sub = subscribeToQueue("q1")!;
    const got: BenchQueueStreamEvent[] = [];
    sub.onEvent((ev) => got.push(ev));

    requestQueueStop("q1");
    expect(pauseQueue("q1")).toBe(false);
    expect(getQueueSnapshot("q1")!.paused).toBe(false);
    expect(got.some((ev) => ev.type === "queue_paused")).toBe(false);
  });

  it("정지 후에는 waitWhileQueuePaused가 매달리지 않는다", async () => {
    makeQueue("q1", ["m1"]);
    pauseQueue("q1");
    requestQueueStop("q1");
    await expect(waitWhileQueuePaused("q1")).resolves.toBeUndefined();
  });

  it("완료·미지의 큐에는 pause/resume/stop이 false다", () => {
    makeQueue("q1", ["m1"]);
    finishQueue("q1", "finished");
    expect(pauseQueue("q1")).toBe(false);
    expect(resumeQueue("q1")).toBe(false);
    expect(requestQueueStop("q1")).toBe(false);
    expect(pauseQueue("nope")).toBe(false);
    expect(resumeQueue("nope")).toBe(false);
    expect(requestQueueStop("nope")).toBe(false);
    expect(isQueueStopRequested("nope")).toBe(false);
  });
});

// ------------------------------------------------------------------ 테스트 훅

/**
 * 리셋 훅은 편의 함수가 아니라 격리 장치다. Map만 비우면 아직 돌고 있는 드라이버 루프가
 * 고아로 남아(대기 중인 waitWhileQueuePaused에 매달린 채) 다음 테스트의 fetch 스텁을 오염시킨다.
 */
describe("_resetBenchQueueRegistryForTests", () => {
  it("실행 중 큐에 정지를 걸어 일시정지 대기자를 깨운다", async () => {
    makeQueue("q1", ["m1", "m2"]);
    markModelRunning("q1", 0);
    markModelRunId("q1", 0, "run-1");
    registerRunControl("run-1");
    pauseQueue("q1");

    const waiter = waitWhileQueuePaused("q1");
    let resolved = false;
    void waiter.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    _resetBenchQueueRegistryForTests();

    await waiter; // 안 깨우면 이 테스트가 타임아웃으로 죽는다 = 고아 루프의 증거
    expect(resolved).toBe(true);
    // 정지는 진행 중인 런에도 전파돼야 드라이버가 즉시 빠져나간다.
    expect(isRunCancelled("run-1")).toBe(true);
    expect(getQueueSnapshot("q1")).toBeNull();
    expect(listQueues()).toEqual([]);
  });

  it("완료 큐만 남아 있어도 조용히 비운다", () => {
    makeQueue("q1", ["m1"]);
    finishQueue("q1", "finished");
    expect(() => _resetBenchQueueRegistryForTests()).not.toThrow();
    expect(getQueueSnapshot("q1")).toBeNull();
    expect(activeQueueForBaseUrl(BASE)).toBeNull();
  });
});
