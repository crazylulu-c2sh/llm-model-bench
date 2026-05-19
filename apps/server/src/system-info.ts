import { execFile as execFileCb, type ExecFileException } from "node:child_process";
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
