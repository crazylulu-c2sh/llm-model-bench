import { afterEach, describe, expect, it } from "vitest";
import type { StreamEvent } from "@llm-bench/shared";
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
