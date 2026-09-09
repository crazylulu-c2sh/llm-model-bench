import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSystemInfoCacheForTest,
  _setExecFileForTest,
  getGpuSnapshot,
  getSystemSnapshot,
  parseAvailableFromVmStat,
  parseIoregAccelerator,
  parseMemAvailableFromMeminfo,
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

describe("parseIoregAccelerator (#185 — macOS Device Utilization %)", () => {
  it("extracts utilization + model name from a real ioreg capture", () => {
    const out = `+-o AGXAcceleratorG13G_B0  <class AGXAcceleratorG13G_B0, id 0x1000006bb, registered, matched, active, busy 0 (133 ms), retain 61>
    {
      "IOMatchedAtBoot" = Yes
      "model" = "Apple M1"
      "PerformanceStatistics" = {"In use system memory (driver)"=0,"Device Utilization %"=23,"Renderer Utilization %"=22}
    }`;
    expect(parseIoregAccelerator(out)).toEqual([{ index: 0, name: "Apple M1", utilizationPct: 23 }]);
  });

  it("falls back to a generic name when model is missing", () => {
    expect(parseIoregAccelerator(`"Device Utilization %"=42`)).toEqual([
      { index: 0, name: "Apple GPU", utilizationPct: 42 },
    ]);
  });

  it("returns [] when no accelerator is present", () => {
    expect(parseIoregAccelerator("")).toEqual([]);
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

describe("사용 가능 메모리 파서", () => {
  it("parseMemAvailableFromMeminfo: MemAvailable(kB)을 바이트로 읽는다", () => {
    const meminfo = [
      "MemTotal:       65805936 kB",
      "MemFree:          410324 kB",
      "MemAvailable:   12345678 kB",
      "Buffers:          123456 kB",
    ].join("\n");
    expect(parseMemAvailableFromMeminfo(meminfo)).toBe(12345678 * 1024);
  });

  it("parseMemAvailableFromMeminfo: 항목이 없으면 null (MemFree 로 오인하지 않는다)", () => {
    expect(parseMemAvailableFromMeminfo("MemTotal: 100 kB\nMemFree: 50 kB")).toBeNull();
  });

  it("parseAvailableFromVmStat: free+inactive+speculative+purgeable 를 페이지 크기로 곱한다", () => {
    const vmstat = [
      "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
      "Pages free:                                    60478.",
      "Pages active:                                 251643.",
      "Pages inactive:                               247969.",
      "Pages speculative:                              3310.",
      "Pages wired down:                             221767.",
      "Pages purgeable:                                1269.",
    ].join("\n");
    // active/wired 는 회수 대상이 아니므로 빠져야 한다
    expect(parseAvailableFromVmStat(vmstat)).toBe((60478 + 247969 + 3310 + 1269) * 16384);
  });

  it("parseAvailableFromVmStat: 페이지 크기를 못 읽으면 null", () => {
    expect(parseAvailableFromVmStat("Pages free: 100.")).toBeNull();
  });
});
