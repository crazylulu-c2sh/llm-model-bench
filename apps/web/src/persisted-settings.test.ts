import { beforeEach, describe, expect, it } from "vitest";
import {
  MONITOR_PREFS_STORAGE_KEY,
  PREFS_STORAGE_KEY,
  readInitialMonitorState,
  readInitialStressState,
  saveMonitorSnapshot,
  saveStressSnapshot,
  STRESS_PREFS_STORAGE_KEY,
} from "./persisted-settings";

/** node 환경에서 localStorage가 없으므로 minimal in-memory mock. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

beforeEach(() => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    writable: true,
    configurable: true,
  });
});

describe("readInitialStressState", () => {
  it("returns defaults when storage is empty", () => {
    const s = readInitialStressState();
    expect(s.workloadId).toBe("stress_ping");
    expect(s.startCC).toBe(1);
    expect(s.maxCC).toBe(8);
    expect(s.stepCC).toBe(1);
    expect(s.durationMs).toBe(5000);
    expect(s.requestTimeoutMs).toBe(30_000);
    expect(s.workerPromptSuffix).toBe(true);
    expect(s.maxTokensOverride).toBe("");
    expect(s.lastSelectedModelId).toBeNull();
  });

  it("falls back to defaults entirely when workloadId is garbage (safeParse fail)", () => {
    window.localStorage.setItem(
      STRESS_PREFS_STORAGE_KEY,
      JSON.stringify({ v: 1, workloadId: "garbage_workload", startCC: 5, durationMs: 8000 }),
    );
    const s = readInitialStressState();
    // safeParse fails → all defaults; the otherwise-valid startCC/durationMs are also reset.
    expect(s.workloadId).toBe("stress_ping");
    expect(s.startCC).toBe(1);
    expect(s.durationMs).toBe(5000);
  });

  it("ignores stored payload when version mismatches", () => {
    window.localStorage.setItem(
      STRESS_PREFS_STORAGE_KEY,
      JSON.stringify({ v: 99, workloadId: "stress_short_reply_ko", startCC: 3 }),
    );
    const s = readInitialStressState();
    expect(s.workloadId).toBe("stress_ping");
    expect(s.startCC).toBe(1);
  });

  it("restores all valid fields on a clean round-trip", () => {
    saveStressSnapshot({
      workloadId: "stress_short_reply_ja",
      startCC: 2,
      maxCC: 12,
      stepCC: 2,
      durationMs: 8000,
      requestTimeoutMs: 60_000,
      workerPromptSuffix: false,
      maxTokensOverride: "64",
      lastSelectedModelId: "gemma-4-26b-a4b-it",
    });
    const s = readInitialStressState();
    expect(s.workloadId).toBe("stress_short_reply_ja");
    expect(s.startCC).toBe(2);
    expect(s.maxCC).toBe(12);
    expect(s.stepCC).toBe(2);
    expect(s.durationMs).toBe(8000);
    expect(s.requestTimeoutMs).toBe(60_000);
    expect(s.workerPromptSuffix).toBe(false);
    expect(s.maxTokensOverride).toBe("64");
    expect(s.lastSelectedModelId).toBe("gemma-4-26b-a4b-it");
  });

  it("auto-corrects startCC > maxCC on save (clamps maxCC up to startCC)", () => {
    saveStressSnapshot({
      workloadId: "stress_ping",
      startCC: 10,
      maxCC: 3, // invalid — should be lifted to >= startCC
      stepCC: 1,
      durationMs: 5000,
      requestTimeoutMs: 30_000,
      workerPromptSuffix: true,
      maxTokensOverride: "",
      lastSelectedModelId: null,
    });
    const s = readInitialStressState();
    expect(s.startCC).toBe(10);
    expect(s.maxCC).toBe(10);
  });
});

describe("readInitialMonitorState", () => {
  it("returns defaults when storage empty (no fallback ui prefs)", () => {
    const s = readInitialMonitorState();
    expect(s.provider).toBe("lm_studio");
    expect(s.pollEnabled).toBe(true);
    expect(s.intervalMs).toBe(5000);
    expect(s.baseUrl).toBe("http://127.0.0.1:1234");
  });

  it("falls back to bench/stress baseUrl when monitor prefs has no baseUrl", () => {
    window.localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({ v: 2, baseUrl: "http://10.20.30.40:1234" }),
    );
    const s = readInitialMonitorState();
    expect(s.baseUrl).toBe("http://10.20.30.40:1234");
  });

  it("ignores stored payload when version mismatches", () => {
    window.localStorage.setItem(
      MONITOR_PREFS_STORAGE_KEY,
      JSON.stringify({ v: 99, baseUrl: "x", provider: "lm_studio" }),
    );
    const s = readInitialMonitorState();
    expect(s.baseUrl).toBe("http://127.0.0.1:1234");
    expect(s.provider).toBe("lm_studio");
  });

  it("round-trips valid fields", () => {
    saveMonitorSnapshot({
      baseUrl: "http://localhost:11434",
      provider: "ollama",
      pollEnabled: false,
      intervalMs: 10000,
    });
    const s = readInitialMonitorState();
    expect(s.baseUrl).toBe("http://localhost:11434");
    expect(s.provider).toBe("ollama");
    expect(s.pollEnabled).toBe(false);
    expect(s.intervalMs).toBe(10000);
  });

  it("rejects invalid provider via schema (falls back to defaults)", () => {
    window.localStorage.setItem(
      MONITOR_PREFS_STORAGE_KEY,
      JSON.stringify({ v: 1, provider: "manual" }),
    );
    const s = readInitialMonitorState();
    expect(s.provider).toBe("lm_studio");
  });

  it("rejects invalid intervalMs via schema", () => {
    window.localStorage.setItem(
      MONITOR_PREFS_STORAGE_KEY,
      JSON.stringify({ v: 1, intervalMs: 1234 }),
    );
    const s = readInitialMonitorState();
    expect(s.intervalMs).toBe(5000);
  });
});
