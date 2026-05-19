import {
  execFile as execFileCb,
  spawn as spawnCb,
  type ChildProcess,
  type ExecFileException,
} from "node:child_process";

type ExecFileFn = typeof execFileCb;
type SpawnFn = typeof spawnCb;

let execFileImpl: ExecFileFn = execFileCb;
let spawnImpl: SpawnFn = spawnCb;

function execFile(
  file: string,
  args: readonly string[],
  opts: Parameters<ExecFileFn>[2],
): Promise<{ stdout: string; stderr: string }> {
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

export function _setSpawnForTest(fn: SpawnFn | null): void {
  spawnImpl = fn ?? spawnCb;
}

export const LMS_ENV_FLAG = "ENABLE_LMS_CLI";

export function isLmsCliEnabled(): boolean {
  return process.env[LMS_ENV_FLAG] === "1";
}

const LMS_BIN = (): string => process.env.LMS_BIN || "lms";

const MODEL_ARG_RE = /^[A-Za-z0-9._\-/:]+$/;
export function isValidModelId(s: unknown): s is string {
  return typeof s === "string" && s.length > 0 && s.length <= 256 && MODEL_ARG_RE.test(s);
}

type AvailabilityCache = { ok: boolean; version?: string; error?: string; ts: number };
let availCache: AvailabilityCache | null = null;
const AVAIL_TTL_MS = 60_000;

export function _resetLmsCliCacheForTest(): void {
  availCache = null;
}

export async function lmsCheckAvailable(): Promise<{ ok: boolean; version?: string; error?: string }> {
  if (!isLmsCliEnabled()) {
    return { ok: false, error: "ENABLE_LMS_CLI not set" };
  }
  if (availCache && Date.now() - availCache.ts < AVAIL_TTL_MS) {
    const { ts, ...rest } = availCache;
    return rest;
  }
  try {
    const { stdout } = await execFile(LMS_BIN(), ["--version"], { timeout: 3000, windowsHide: true });
    const version = stdout.trim().split("\n")[0] ?? "";
    availCache = { ok: true, version, ts: Date.now() };
    return { ok: true, version };
  } catch (e) {
    const error = (e as ExecFileException).message ?? String(e);
    availCache = { ok: false, error, ts: Date.now() };
    return { ok: false, error };
  }
}

function requireEnabledOrThrow(): void {
  if (!isLmsCliEnabled()) {
    throw new Error("ENABLE_LMS_CLI not set");
  }
}

export type LmsExecResult = { ok: boolean; stdout?: string; error?: string };

export async function lmsPs(timeoutMs = 5000): Promise<LmsExecResult> {
  requireEnabledOrThrow();
  try {
    const r = await execFile(LMS_BIN(), ["ps", "--json"], { timeout: timeoutMs, windowsHide: true });
    return { ok: true, stdout: r.stdout };
  } catch {
    try {
      const r = await execFile(LMS_BIN(), ["ps"], { timeout: timeoutMs, windowsHide: true });
      return { ok: true, stdout: r.stdout };
    } catch (e) {
      return { ok: false, error: (e as ExecFileException).message ?? String(e) };
    }
  }
}

export async function lmsLoad(model: string, timeoutMs = 120_000): Promise<LmsExecResult> {
  requireEnabledOrThrow();
  if (!isValidModelId(model)) return { ok: false, error: "invalid_model_id" };
  try {
    const r = await execFile(LMS_BIN(), ["load", model], { timeout: timeoutMs, windowsHide: true });
    return { ok: true, stdout: r.stdout };
  } catch (e) {
    return { ok: false, error: (e as ExecFileException).message ?? String(e) };
  }
}

export async function lmsUnload(model: string, timeoutMs = 15_000): Promise<LmsExecResult> {
  requireEnabledOrThrow();
  if (!isValidModelId(model)) return { ok: false, error: "invalid_model_id" };
  try {
    const r = await execFile(LMS_BIN(), ["unload", model], { timeout: timeoutMs, windowsHide: true });
    return { ok: true, stdout: r.stdout };
  } catch (e) {
    return { ok: false, error: (e as ExecFileException).message ?? String(e) };
  }
}

export async function lmsServerStatus(timeoutMs = 5000): Promise<LmsExecResult> {
  requireEnabledOrThrow();
  try {
    const r = await execFile(LMS_BIN(), ["server", "status"], { timeout: timeoutMs, windowsHide: true });
    return { ok: true, stdout: r.stdout };
  } catch (e) {
    return { ok: false, error: (e as ExecFileException).message ?? String(e) };
  }
}

export function spawnLmsLogStream(): ChildProcess {
  if (!isLmsCliEnabled()) throw new Error("ENABLE_LMS_CLI not set");
  return spawnImpl(LMS_BIN(), ["log", "stream"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}
