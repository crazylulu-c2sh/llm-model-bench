import { afterEach, describe, expect, it } from "vitest";
import type { BenchQueuePlan, BenchRunMeta, StreamEvent } from "@llm-bench/shared";
import {
  _resetLiveRunRegistryForTests,
  endLiveRun,
  listLiveRuns,
  publishLiveEvent,
  startLiveRun,
  subscribeToLiveRun,
} from "./bench-live-registry.js";

afterEach(() => {
  _resetLiveRunRegistryForTests();
});

const INFO = { base_url: "http://127.0.0.1:1234", model_id: "m1", provider: "lm_studio", started_at: 0 };

describe("bench-live-registry", () => {
  it("listLiveRuns reflects started/ended runs", () => {
    expect(listLiveRuns()).toEqual([]);
    startLiveRun("r1", INFO);
    expect(listLiveRuns()).toEqual([{ run_id: "r1", ...INFO, paused: false }]);
    endLiveRun("r1");
    expect(listLiveRuns()).toEqual([]);
  });

  it("publishLiveEvent buffers non-token_delta events and excludes token_delta", () => {
    startLiveRun("r1", INFO);
    const started: StreamEvent = { type: "run_started", run_id: "r1" };
    const delta: StreamEvent = { type: "token_delta", scenario_id: "chat_ping", text: "hi" };
    publishLiveEvent("r1", started);
    publishLiveEvent("r1", delta);
    const sub = subscribeToLiveRun("r1");
    expect(sub?.bufferedEvents).toEqual([started]);
  });

  it("publishLiveEvent tracks paused state via run_paused/run_resumed", () => {
    startLiveRun("r1", INFO);
    publishLiveEvent("r1", { type: "run_paused" });
    expect(listLiveRuns()[0]?.paused).toBe(true);
    publishLiveEvent("r1", { type: "run_resumed" });
    expect(listLiveRuns()[0]?.paused).toBe(false);
  });

  it("subscribeToLiveRun forwards live events to subscribers until unsubscribed", () => {
    startLiveRun("r1", INFO);
    const sub = subscribeToLiveRun("r1")!;
    const received: StreamEvent[] = [];
    sub.onEvent((ev) => received.push(ev));

    const ev1: StreamEvent = { type: "model_loaded", model_id: "m1", provider: "lm_studio" };
    publishLiveEvent("r1", ev1);
    expect(received).toEqual([ev1]);

    sub.unsubscribe();
    publishLiveEvent("r1", { type: "run_finished", run_id: "r1" });
    expect(received).toEqual([ev1]); // 구독 해제 후엔 더 안 옴
  });

  it("subscribeToLiveRun's onDone fires when the run ends", () => {
    startLiveRun("r1", INFO);
    const sub = subscribeToLiveRun("r1")!;
    let done = false;
    sub.onDone(() => {
      done = true;
    });
    endLiveRun("r1");
    expect(done).toBe(true);
  });

  it("subscribeToLiveRun returns null for an unknown runId", () => {
    expect(subscribeToLiveRun("missing")).toBeNull();
  });

  it("multiple subscribers all receive the same live events (multi-tab reconnect)", () => {
    startLiveRun("r1", INFO);
    const subA = subscribeToLiveRun("r1")!;
    const subB = subscribeToLiveRun("r1")!;
    const gotA: StreamEvent[] = [];
    const gotB: StreamEvent[] = [];
    subA.onEvent((ev) => gotA.push(ev));
    subB.onEvent((ev) => gotB.push(ev));
    const ev: StreamEvent = { type: "run_finished", run_id: "r1" };
    publishLiveEvent("r1", ev);
    expect(gotA).toEqual([ev]);
    expect(gotB).toEqual([ev]);
  });
});

const META: BenchRunMeta = {
  run_id: "r1",
  base_url: INFO.base_url,
  provider: "lm_studio",
  model_id: "m1",
  api_routes: ["chat_completions"],
  scenario_ids: ["chat_hello", "chat_ping"],
  scenario_bundle_version: "4",
  temperature: 0.2,
  max_tokens: 512,
  parallel: false,
  warmup_runs: 1,
  measured_runs: 3,
  created_at: "2026-01-01T00:00:00.000Z",
};

/** 오염 가드 대기처럼 한 런에서 수백 건이 쏟아지는 이벤트 — 링버퍼(500)를 넘기는 용도. */
function floodContentionWaiting(runId: string, count: number): void {
  for (let i = 0; i < count; i++) {
    publishLiveEvent(runId, {
      type: "contention_waiting",
      phase: "pre_bench",
      waiting_reason: "gpu_busy",
      reasons: ["gpu_busy"],
      gpu_signal_available: true,
      elapsed_ms: i,
    });
  }
}

describe("bench-live-registry: run_started 핀", () => {
  it("run_started는 링버퍼 축출을 견딘다", () => {
    // 이게 밀려나면 재연결 탭이 시나리오 계획·warmup/measured·run_id를 통째로 잃는다.
    startLiveRun("r1", INFO);
    publishLiveEvent("r1", { type: "run_started", run_id: "r1", meta: META });
    floodContentionWaiting("r1", 600);

    const first = subscribeToLiveRun("r1")!.bufferedEvents[0];
    expect(first?.type).toBe("run_started");
    expect(first?.type === "run_started" && first.meta).toEqual(META);
  });

  it("replay에서 run_started가 중복되지 않는다", () => {
    // 핀과 버퍼 양쪽에 넣으면 클라이언트가 같은 런을 두 번 초기화한다.
    startLiveRun("r1", INFO);
    publishLiveEvent("r1", { type: "run_started", run_id: "r1", meta: META });
    publishLiveEvent("r1", { type: "model_loaded", model_id: "m1", provider: "lm_studio" });

    const replay = subscribeToLiveRun("r1")!.bufferedEvents;
    expect(replay.filter((ev) => ev.type === "run_started")).toHaveLength(1);
    expect(replay).toHaveLength(2);
  });

  it("두 번째 run_started는 핀을 덮어쓰지 않는다", () => {
    startLiveRun("r1", INFO);
    const first: StreamEvent = { type: "run_started", run_id: "r1", meta: META };
    publishLiveEvent("r1", first);
    publishLiveEvent("r1", { type: "run_started", run_id: "r1-dup" });

    // 선두는 meta를 가진 최초 run_started 그대로여야 한다.
    expect(subscribeToLiveRun("r1")!.bufferedEvents[0]).toEqual(first);
  });
});

describe("bench-live-registry: 큐 메타데이터", () => {
  it("listLiveRuns가 plan·queue_id를 노출한다", () => {
    // SSE를 열지 않고도 /bench/running만으로 시나리오 계획과 소속 큐를 알 수 있어야 한다.
    const plan: BenchQueuePlan = {
      scenario_ids: ["chat_hello", "chat_ping"],
      api_routes: ["chat_completions"],
      warmup_runs: 1,
      measured_runs: 3,
    };
    startLiveRun("r1", { ...INFO, plan, queue_id: "q1" });

    const summary = listLiveRuns()[0];
    expect(summary?.plan).toEqual(plan);
    expect(summary?.queue_id).toBe("q1");
  });

  it("단독 런은 plan·queue_id 없이도 나열된다", () => {
    startLiveRun("r1", INFO);
    const summary = listLiveRuns()[0];
    expect(summary?.plan).toBeUndefined();
    expect(summary?.queue_id).toBeUndefined();
  });
});
