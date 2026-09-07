import { execFile as execFileCb, type ExecFileException } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import type { GpuSnapshot, SystemSnapshot } from "@llm-bench/shared";

type ExecFileFn = typeof execFileCb;
type ExecFileResult = { stdout: string; stderr: string };

let execFileImpl: ExecFileFn = execFileCb;

function execFile(
  file: string,
  args: readonly string[],
  opts: Parameters<ExecFileFn>[2],
): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args as string[], opts ?? {}, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({
        stdout: typeof stdout === "string" ? stdout : stdout?.toString("utf-8") ?? "",
        stderr: typeof stderr === "string" ? stderr : stderr?.toString("utf-8") ?? "",
      });
    });
  });
}

export function _setExecFileForTest(fn: ExecFileFn | null): void {
  execFileImpl = fn ?? execFileCb;
}

const SYSTEM_TTL_MS = 5_000;
const GPU_TTL_MS = 5_000;

let systemCache: { data: SystemSnapshot; expires: number } | null = null;
let gpuCache: { data: GpuSnapshot; expires: number } | null = null;
let gpuInflight: Promise<GpuSnapshot> | null = null;

export function _resetSystemInfoCacheForTest(): void {
  systemCache = null;
  gpuCache = null;
  gpuInflight = null;
}

export function getSystemSnapshot(): SystemSnapshot {
  const now = Date.now();
  if (systemCache && systemCache.expires > now) return systemCache.data;
  const la = os.loadavg();
  const snap: SystemSnapshot = {
    ts: new Date(now).toISOString(),
    totalMemBytes: os.totalmem(),
    freeMemBytes: os.freemem(),
    loadavg: [la[0] ?? 0, la[1] ?? 0, la[2] ?? 0],
    cpuCount: os.cpus().length || 1,
    platform: os.platform(),
  };
  systemCache = { data: snap, expires: now + SYSTEM_TTL_MS };
  return snap;
}

export async function getGpuSnapshot(timeoutMs = 3000): Promise<GpuSnapshot> {
  const now = Date.now();
  if (gpuCache && gpuCache.expires > now) return gpuCache.data;
  if (gpuInflight) return gpuInflight;
  gpuInflight = (async () => {
    try {
      const { stdout } = await execFile(
        "nvidia-smi",
        [
          "--query-gpu=index,name,memory.total,memory.used,utilization.gpu",
          "--format=csv,noheader,nounits",
        ],
        { timeout: timeoutMs, windowsHide: true },
      );
      const devices = parseNvidiaSmiCsv(stdout);
      const snap: GpuSnapshot = { available: true, devices };
      gpuCache = { data: snap, expires: Date.now() + GPU_TTL_MS };
      return snap;
    } catch (e) {
      const error = (e as ExecFileException).message ?? String(e);
      const snap: GpuSnapshot = { available: false, devices: [], error };
      gpuCache = { data: snap, expires: Date.now() + GPU_TTL_MS };
      return snap;
    } finally {
      gpuInflight = null;
    }
  })();
  return gpuInflight;
}

export function parseNvidiaSmiCsv(stdout: string): GpuSnapshot["devices"] {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((row) => {
      const parts = row.split(",").map((s) => s.trim());
      return {
        index: Number(parts[0] ?? 0),
        name: parts[1] ?? "",
        memoryTotalMiB: Number(parts[2] ?? 0),
        memoryUsedMiB: Number(parts[3] ?? 0),
        utilizationPct: Number(parts[4] ?? 0),
      };
    })
    .filter((d) => Number.isFinite(d.memoryTotalMiB));
}

// ── 사용 가능 메모리 ─────────────────────────────────────────────────────────
//
// `os.freemem()`은 **완전히 비어 있는** 페이지만 센다. 현대 OS는 남는 메모리를
// 캐시로 쓰므로 이 값은 늘 바닥에 붙어 있고(이 macOS 호스트: 16 GiB 중 0.96 GiB),
// "이 모델이 들어갈 자리가 있나"를 묻는 데는 쓸 수 없다. 필요한 건 캐시처럼
// OS가 회수할 수 있는 몫까지 포함한 **available** 이다.

const AVAILABLE_MEM_TTL_MS = 5_000;
let availableMemCache: { bytes: number; expires: number } | null = null;

export function _resetAvailableMemCacheForTest(): void {
  availableMemCache = null;
}

/** Linux `/proc/meminfo`의 `MemAvailable`(kB) → bytes. 항목이 없으면 null. */
export function parseMemAvailableFromMeminfo(text: string): number | null {
  const m = text.match(/^MemAvailable:\s+(\d+)\s*kB$/im);
  if (!m) return null;
  const kb = Number(m[1]);
  return Number.isFinite(kb) ? kb * 1024 : null;
}

/**
 * macOS `vm_stat` → 회수 가능한 바이트.
 * free + inactive + speculative + purgeable. inactive/speculative 는 즉시 재사용
 * 가능한 파일 캐시이고 purgeable 은 커널이 버릴 수 있는 몫이다.
 */
export function parseAvailableFromVmStat(text: string): number | null {
  const pageSize = Number(text.match(/page size of (\d+) bytes/i)?.[1]);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null;
  const pages = (label: string): number => {
    const m = text.match(new RegExp(`^Pages ${label}:\\s+(\\d+)\\.?$`, "im"));
    return m ? Number(m[1]) : 0;
  };
  const free = pages("free");
  if (free === 0 && !/^Pages free:/im.test(text)) return null;
  return (free + pages("inactive") + pages("speculative") + pages("purgeable")) * pageSize;
}

/**
 * OS가 회수할 수 있는 몫까지 포함한 사용 가능 메모리(바이트).
 * 플랫폼별 소스를 읽지 못하면 `os.freemem()`으로 되돌아간다(과소평가일 뿐 안전한 방향).
 */
export async function getAvailableMemBytes(): Promise<number> {
  const now = Date.now();
  if (availableMemCache && availableMemCache.expires > now) return availableMemCache.bytes;
  let bytes: number | null = null;
  try {
    if (process.platform === "linux") {
      bytes = parseMemAvailableFromMeminfo(await readFile("/proc/meminfo", "utf-8"));
    } else if (process.platform === "darwin") {
      const { stdout } = await execFile("vm_stat", [], { timeout: 2000 });
      bytes = parseAvailableFromVmStat(stdout);
    }
  } catch {
    bytes = null; // 소스를 못 읽으면 아래 폴백
  }
  const value = bytes != null && bytes > 0 ? bytes : os.freemem();
  availableMemCache = { bytes: value, expires: now + AVAILABLE_MEM_TTL_MS };
  return value;
}
