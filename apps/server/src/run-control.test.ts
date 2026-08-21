import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetRunControlRegistryForTests,
  cancelRunControl,
  isRunCancelled,
  isRunPaused,
  pauseRunControl,
  registerRunControl,
  resumeRunControl,
  unregisterRunControl,
  waitWhileRunPaused,
} from "./run-control.js";

afterEach(() => {
  _resetRunControlRegistryForTests();
});

describe("run-control registry", () => {
  it("pause/resume/isRunPaused round-trip for a registered run", () => {
    registerRunControl("r1");
    expect(isRunPaused("r1")).toBe(false);
    expect(pauseRunControl("r1")).toBe(true);
    expect(isRunPaused("r1")).toBe(true);
    expect(resumeRunControl("r1")).toBe(true);
    expect(isRunPaused("r1")).toBe(false);
  });

  it("pause/resume/isRunPaused are no-ops for an unregistered run", () => {
    expect(pauseRunControl("missing")).toBe(false);
    expect(resumeRunControl("missing")).toBe(false);
    expect(isRunPaused("missing")).toBe(false);
  });

  it("unregisterRunControl removes the entry", () => {
    registerRunControl("r2");
    unregisterRunControl("r2");
    expect(pauseRunControl("r2")).toBe(false);
  });

  it("waitWhileRunPaused resolves immediately when not paused", async () => {
    registerRunControl("r3");
    await expect(waitWhileRunPaused("r3", 1000)).resolves.toBeUndefined();
  });

  it("waitWhileRunPaused resolves when resumeRunControl is called", async () => {
    registerRunControl("r4");
    pauseRunControl("r4");
    const waiter = waitWhileRunPaused("r4", 60_000);
    let resolved = false;
    void waiter.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    resumeRunControl("r4");
    await waiter;
    expect(resolved).toBe(true);
  });

  it("waitWhileRunPaused auto-resumes after maxWaitMs so a run never sticks paused forever", async () => {
    vi.useFakeTimers();
    try {
      registerRunControl("r5");
      pauseRunControl("r5");
      const waiter = waitWhileRunPaused("r5", 1000);
      let resolved = false;
      void waiter.then(() => {
        resolved = true;
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(resolved).toBe(true);
      expect(isRunPaused("r5")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waitWhileRunPaused registered for an unregistered run resolves immediately", async () => {
    await expect(waitWhileRunPaused("nope", 1000)).resolves.toBeUndefined();
  });

  it("registerRunControl returns a signal that cancelRunControl aborts", () => {
    const signal = registerRunControl("r6");
    expect(signal.aborted).toBe(false);
    expect(cancelRunControl("r6")).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(isRunCancelled("r6")).toBe(true);
  });

  it("cancelRunControl wakes a run that is currently paused-and-waiting", async () => {
    registerRunControl("r7");
    pauseRunControl("r7");
    const waiter = waitWhileRunPaused("r7", 60_000);
    let resolved = false;
    void waiter.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    cancelRunControl("r7");
    await waiter;
    expect(resolved).toBe(true);
    expect(isRunPaused("r7")).toBe(false);
    expect(isRunCancelled("r7")).toBe(true);
  });

  it("pauseRunControl is a no-op once a run is cancelled", () => {
    registerRunControl("r8");
    cancelRunControl("r8");
    expect(pauseRunControl("r8")).toBe(false);
    expect(isRunPaused("r8")).toBe(false);
  });

  it("cancelRunControl is a no-op for an unregistered run", () => {
    expect(cancelRunControl("missing")).toBe(false);
    expect(isRunCancelled("missing")).toBe(false);
  });
});
