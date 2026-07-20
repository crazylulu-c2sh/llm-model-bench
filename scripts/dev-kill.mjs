import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import path from "node:path";
import { loadDevPorts, root } from "./dev-ports.mjs";

// 좀비 dev 프로세스 정리기.
//
// 안전 규칙 두 개로 오폭을 막는다:
//   1) cwd가 이 저장소 안인 프로세스만 후보 — 다른 저장소의 vite/tsx는 절대 건드리지 않는다.
//   2) 자기 자신과 조상은 제외 — 안 그러면 `pnpm dev:kill`이 자기를 실행한 셸을 죽인다.
// 포트를 점유한 게 외부 프로세스면 죽이지 않고 경고만 한다.

const dryRun = process.argv.includes("--dry-run") || process.argv.includes("-n");

// cwd가 저장소 안이어도 에디터나 셸일 수 있으므로 dev 프로세스 모양까지 확인한다.
const DEV_CMD_PATTERNS = [
  "scripts/dev.mjs",
  "tsx",
  "vite",
  "@llm-bench/",
  "apps/server/src/index.ts",
];

if (process.platform !== "linux") {
  console.error(
    `[dev:kill] /proc 기반이라 linux에서만 동작합니다 (현재: ${process.platform}). ` +
      `수동으로 dev 포트를 점유한 프로세스를 종료하세요.`,
  );
  process.exit(1);
}

let ports = null;
try {
  ports = loadDevPorts();
} catch (err) {
  // 포트를 몰라도 프로세스 스캔은 할 수 있으니 계속 진행.
  console.warn(`[dev:kill] 포트 확인 불가 (${err.message}) — 프로세스 스캔만 수행합니다.`);
}
const devPorts = ports ? [ports.serverPort, ports.vitePort, ports.mcpPort].filter(Boolean) : [];

function readProc(pid, file) {
  try {
    return readFileSync(`/proc/${pid}/${file}`, "utf8");
  } catch {
    return null;
  }
}

function ppidOf(pid) {
  const status = readProc(pid, "status");
  const match = status?.match(/^PPid:\s*(\d+)$/m);
  return match ? Number(match[1]) : null;
}

function cwdOf(pid) {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null; // 권한 없음 또는 이미 종료됨
  }
}

function cmdOf(pid) {
  const raw = readProc(pid, "cmdline");
  if (!raw) return null;
  return raw.split("\0").filter(Boolean).join(" ");
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 자기 자신 + 모든 조상 — 이 집합은 절대 죽이지 않는다. */
function selfAncestry() {
  const chain = new Set();
  let pid = process.pid;
  while (pid && pid > 1 && !chain.has(pid)) {
    chain.add(pid);
    pid = ppidOf(pid);
  }
  return chain;
}

function inRepo(cwd) {
  return cwd === root || cwd?.startsWith(root + path.sep);
}

/** 포트 -> 리스닝 중인 pid 목록. ss가 없으면 빈 맵. */
function listenersByPort() {
  const map = new Map();
  let out;
  try {
    out = execFileSync("ss", ["-ltnpH"], { encoding: "utf8" });
  } catch {
    return map;
  }
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const local = line.trim().split(/\s+/)[3];
    const port = Number(local?.slice(local.lastIndexOf(":") + 1));
    if (!devPorts.includes(port)) continue;
    for (const m of line.matchAll(/pid=(\d+)/g)) {
      if (!map.has(port)) map.set(port, new Set());
      map.get(port).add(Number(m[1]));
    }
  }
  return map;
}

const protectedPids = selfAncestry();
const listeners = listenersByPort();
const listenerPids = new Set([...listeners.values()].flatMap((s) => [...s]));

const targets = [];
const foreign = [];

for (const entry of readdirSync("/proc")) {
  const pid = Number(entry);
  if (!Number.isInteger(pid) || pid <= 1) continue;
  if (protectedPids.has(pid)) continue;

  const cwd = cwdOf(pid);
  const cmd = cmdOf(pid);
  if (!cmd) continue;

  if (!inRepo(cwd)) {
    // 우리 포트를 남의 프로세스가 잡고 있으면 알려만 준다.
    if (listenerPids.has(pid)) foreign.push({ pid, cmd, cwd });
    continue;
  }
  // 포트를 잡고 있으면 cmdline 모양은 따지지 않는다 — 어차피 dev를 막는 주범.
  const looksLikeDev = listenerPids.has(pid) || DEV_CMD_PATTERNS.some((p) => cmd.includes(p));
  if (!looksLikeDev) continue;

  targets.push({ pid, cmd, ports: [...listeners].filter(([, s]) => s.has(pid)).map(([p]) => p) });
}

for (const { pid, cmd, cwd } of foreign) {
  const held = [...listeners].filter(([, s]) => s.has(pid)).map(([p]) => p);
  console.warn(
    `[dev:kill] 경고: 포트 ${held.join(", ")}를 이 저장소 밖 프로세스가 점유 중 — 건드리지 않습니다.\n` +
      `           pid=${pid} cwd=${cwd ?? "?"} ${cmd}`,
  );
}

if (targets.length === 0) {
  console.log("[dev:kill] 정리할 좀비 dev 프로세스가 없습니다.");
  process.exit(foreign.length > 0 ? 1 : 0);
}

// 부모부터 정리해야 watcher가 자식을 되살리지 않는다.
targets.sort((a, b) => a.pid - b.pid);

for (const { pid, cmd, ports: held } of targets) {
  const suffix = held.length > 0 ? ` [port ${held.join(", ")}]` : "";
  console.log(`[dev:kill] ${dryRun ? "(dry-run) " : ""}kill ${pid}${suffix} — ${cmd}`);
}
if (dryRun) process.exit(0);

for (const { pid } of targets) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* 이미 종료됨 */
  }
}

// SIGTERM에 안 죽은 것만 SIGKILL.
await new Promise((resolve) => setTimeout(resolve, 1500));
const survivors = targets.filter(({ pid }) => isAlive(pid));
for (const { pid } of survivors) {
  console.log(`[dev:kill] SIGTERM 무시 — SIGKILL ${pid}`);
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* 이미 종료됨 */
  }
}

console.log(`[dev:kill] ${targets.length}개 프로세스 정리 완료.`);
