import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSystemInfoCacheForTest,
  _setExecFileForTest,
  getGpuSnapshot,
  getSystemSnapshot,
  parseNvidiaSmiCsv,
} from "./system-info";

beforeEach(() => {
  _resetSystemInfoCacheForTest();
});
afterEach(() => {
  _setExecFileForTest(null);
  _resetSystemInfoCacheForTest();
});

describe("getSystemSnapshot", () => {
  it("returns plausible shape", () => {
    const s = getSystemSnapshot();
    expect(s.totalMemBytes).toBeGreaterThan(0);
    expect(s.freeMemBytes).toBeGreaterThanOrEqual(0);
    expect(s.cpuCount).toBeGreaterThanOrEqual(1);
    expect(s.loadavg).toHaveLength(3);
    expect(typeof s.platform).toBe("string");
  });

  it("caches within TTL", () => {
    const s1 = getSystemSnapshot();
    const s2 = getSystemSnapshot();
    expect(s2.ts).toBe(s1.ts);
  });
});

describe("parseNvidiaSmiCsv", () => {
  it("parses single device", () => {
    const out = "0, NVIDIA GeForce RTX 4090, 24576, 1234, 42";
    const devices = parseNvidiaSmiCsv(out);
    expect(devices).toEqual([
      {
        index: 0,
        name: "NVIDIA GeForce RTX 4090",
        memoryTotalMiB: 24576,
        memoryUsedMiB: 1234,
        utilizationPct: 42,
      },
    ]);
  });

  it("parses multi-device", () => {
    const out = "0, A, 100, 10, 5\n1, B, 200, 20, 10\n\n";
    expect(parseNvidiaSmiCsv(out)).toHaveLength(2);
  });

  it("returns [] for empty", () => {
    expect(parseNvidiaSmiCsv("")).toEqual([]);
  });
});

describe("getGpuSnapshot", () => {
  it("returns available=true on successful nvidia-smi", async () => {
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      cb?.(null, "0, GPU, 1000, 100, 50\n", "");
      return {} as never;
    }) as never);
    const snap = await getGpuSnapshot();
    expect(snap.available).toBe(true);
    expect(snap.devices).toHaveLength(1);
  });

  it("returns available=false when nvidia-smi missing", async () => {
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      const err = new Error("ENOENT") as Error & { code?: string };
      err.code = "ENOENT";
      cb?.(err, "", "");
      return {} as never;
    }) as never);
    const snap = await getGpuSnapshot();
    expect(snap.available).toBe(false);
    expect(snap.devices).toEqual([]);
    expect(snap.error).toBeTruthy();
  });

  it("shares in-flight promise for concurrent calls", async () => {
    let spawned = 0;
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      spawned += 1;
      // 약간 지연 후 결과 반환
      setTimeout(() => cb?.(null, "0, G, 100, 10, 1\n", ""), 5);
      return {} as never;
    }) as never);
    const [a, b, c] = await Promise.all([
      getGpuSnapshot(),
      getGpuSnapshot(),
      getGpuSnapshot(),
    ]);
    expect(spawned).toBe(1);
    expect(a.available).toBe(true);
    expect(b.available).toBe(true);
    expect(c.available).toBe(true);
  });

  it("caches after successful call within TTL", async () => {
    let spawned = 0;
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      spawned += 1;
      cb?.(null, "0, G, 100, 10, 1\n", "");
      return {} as never;
    }) as never);
    await getGpuSnapshot();
    await getGpuSnapshot();
    await getGpuSnapshot();
    expect(spawned).toBe(1);
  });
});
