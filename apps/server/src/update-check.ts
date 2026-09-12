/**
 * GitHub main vs 로컬 main HEAD 비교 — 업데이트 배너용.
 *
 * 로컬 branch/SHA는 프로세스 기동 시 1회만 스냅샷한다(pm2가 같은 워킹트리에서 pull돼도
 * 재시작 전엔 실행 중인 빌드의 SHA로 비교). GitHub Compare만 캐시 TTL로 재조회한다.
 * fail-closed: git/GitHub 실패는 전부 `unavailable`(HTTP 200). 오프라인·방화벽에서도 벤치 UI를 깨지 않는다.
 * `git fetch`는 하지 않는다(자격증명·원격 변경 없음). Compare API만 사용.
 */
import { execFile as execFileCb, type ExecFileException } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export type UpdateCheckStatus =
  | "behind"
  | "current"
  | "ahead"
  | "diverged"
  | "not_main"
  | "unavailable";

export type UpdateCheckResult = {
  status: UpdateCheckStatus;
  branch?: string;
  localSha?: string;
  remoteSha?: string;
  behindBy?: number;
  aheadBy?: number;
  compareUrl?: string;
  /** 디버그용. UI는 표시하지 않음. */
  reason?: string;
};

const DEFAULT_REPO = "crazylulu-c2sh/llm-model-bench";
const GITHUB_TIMEOUT_MS = 3_000;
const SUCCESS_CACHE_MS = 60 * 60 * 1000;
const FAILURE_CACHE_MS = 5 * 60 * 1000;

type ExecFileFn = typeof execFileCb;
type FetchFn = typeof fetch;

let execFileImpl: ExecFileFn = execFileCb;
let fetchImpl: FetchFn = globalThis.fetch;
let nowImpl: () => number = () => Date.now();

/** 테스트용 — execFile 주입. null이면 기본값 복원. */
export function _setExecFileForTest(fn: ExecFileFn | null): void {
  execFileImpl = fn ?? execFileCb;
}

/** 테스트용 — fetch 주입. null이면 기본값 복원. */
export function _setFetchForTest(fn: FetchFn | null): void {
  fetchImpl = fn ?? globalThis.fetch;
}

/** 테스트용 — 시계 주입. null이면 Date.now 복원. */
export function _setNowForTest(fn: (() => number) | null): void {
  nowImpl = fn ?? (() => Date.now());
}

type CacheEntry = { expiresAt: number; result: UpdateCheckResult };

let cache: CacheEntry | null = null;

type LocalGitSnapshot =
  | { ok: true; branch: string; sha: string | null }
  | { ok: false; reason: "no_git" };

/** 기동 시 1회 고정. `undefined` = 아직 안 읽음. 실패(`no_git`)도 재시도하지 않는다. */
let localGit: LocalGitSnapshot | undefined;

/** 테스트용 — 메모리 캐시 비우기. */
export function _clearUpdateCheckCacheForTest(): void {
  cache = null;
}

/** 테스트용 — 로컬 git 스냅샷 해제(다음 조회/기동 훅이 다시 읽게). */
export function _clearLocalGitSnapshotForTest(): void {
  localGit = undefined;
}

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

/** 모노레포 루트 — `apps/server/src` → `../..`. cwd와 무관. */
export function resolveRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..");
}

function githubRepoSlug(): string {
  const raw = process.env.GITHUB_REPO?.trim();
  if (raw && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw)) return raw;
  return DEFAULT_REPO;
}

function unavailable(reason: string): UpdateCheckResult {
  return { status: "unavailable", reason };
}

function cachePut(result: UpdateCheckResult): UpdateCheckResult {
  const ttl = result.status === "unavailable" ? FAILURE_CACHE_MS : SUCCESS_CACHE_MS;
  cache = { expiresAt: nowImpl() + ttl, result };
  return result;
}

async function git(root: string, gitArgs: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await execFile("git", ["-C", root, ...gitArgs], {
      timeout: 3_000,
      windowsHide: true,
    });
    const out = stdout.trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

async function readLocalGitOnce(): Promise<LocalGitSnapshot> {
  const root = resolveRepoRoot();
  const branch = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch) {
    return { ok: false, reason: "no_git" };
  }
  const sha = await git(root, ["rev-parse", "HEAD"]);
  return { ok: true, branch, sha };
}

async function ensureLocalGit(): Promise<LocalGitSnapshot> {
  if (localGit === undefined) {
    localGit = await readLocalGitOnce();
  }
  return localGit;
}

/**
 * 프로세스 기동 시 로컬 branch/SHA를 1회 고정한다. 이미 있으면 no-op.
 * `serve()` 전에 호출해야 첫 HTTP 요청보다 앞선 pull이 스냅샷에 섞이지 않는다.
 */
export async function snapshotLocalGitAtBoot(): Promise<void> {
  await ensureLocalGit();
}

type CompareJson = {
  status?: string;
  /** head(main)가 base(local)보다 앞선 커밋 수 = 로컬이 뒤처진 양 */
  ahead_by?: number;
  /** head(main)가 base(local)보다 뒤처진 커밋 수 = 로컬이 앞선 양 */
  behind_by?: number;
  commits?: Array<{ sha?: string }>;
};

async function fetchGithubCompare(
  repo: string,
  localSha: string,
): Promise<{ ok: true; body: CompareJson } | { ok: false; reason: string }> {
  const url = `https://api.github.com/repos/${repo}/compare/${localSha}...main`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "llm-model-bench-update-check",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GITHUB_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers, signal: ac.signal });
    if (!res.ok) {
      return { ok: false, reason: `github_http_${res.status}` };
    }
    let body: CompareJson;
    try {
      body = (await res.json()) as CompareJson;
    } catch {
      return { ok: false, reason: "github_bad_json" };
    }
    return { ok: true, body };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      return { ok: false, reason: "github_timeout" };
    }
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as ExecFileException).code ?? "")
        : "";
    if (
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN" ||
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      code === "ENETUNREACH" ||
      code === "EHOSTUNREACH"
    ) {
      return { ok: false, reason: "github_unreachable" };
    }
    return { ok: false, reason: "github_unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 기동 시 스냅샷한 로컬 HEAD와 GitHub `main`을 비교한다.
 * 예외를 밖으로 던지지 않는다 — 항상 `UpdateCheckResult`를 반환.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const now = nowImpl();
  if (cache && cache.expiresAt > now) {
    return cache.result;
  }

  try {
    const snap = await ensureLocalGit();
    if (!snap.ok) {
      return cachePut(unavailable("no_git"));
    }
    const { branch } = snap;
    if (branch === "HEAD") {
      return cachePut({ status: "not_main", branch: "HEAD", reason: "detached_head" });
    }
    if (branch !== "main") {
      return cachePut({ status: "not_main", branch, reason: "not_main" });
    }

    const localSha = snap.sha;
    if (!localSha || !/^[0-9a-f]{7,40}$/i.test(localSha)) {
      return cachePut(unavailable("no_git"));
    }

    const repo = githubRepoSlug();
    const compare = await fetchGithubCompare(repo, localSha);
    if (!compare.ok) {
      return cachePut(unavailable(compare.reason));
    }

    const { body } = compare;
    // compare/{local}...main → GitHub ahead_by = main에만 있는 커밋 = 로컬 behindBy
    const behindBy = typeof body.ahead_by === "number" ? body.ahead_by : 0;
    const aheadBy = typeof body.behind_by === "number" ? body.behind_by : 0;
    const tipCommit = Array.isArray(body.commits) ? body.commits[body.commits.length - 1] : undefined;
    const remoteSha = typeof tipCommit?.sha === "string" ? tipCommit.sha : undefined;
    const compareUrl = `https://github.com/${repo}/compare/${localSha}...main`;

    // GitHub status는 head(main) 기준: ahead=우리가 뒤처짐, behind=우리가 앞섬
    let status: UpdateCheckStatus;
    if (body.status === "identical" || (aheadBy === 0 && behindBy === 0)) {
      status = "current";
    } else if (behindBy > 0 && aheadBy === 0) {
      status = "behind";
    } else if (aheadBy > 0 && behindBy === 0) {
      status = "ahead";
    } else if (behindBy > 0 && aheadBy > 0) {
      status = "diverged";
    } else if (body.status === "ahead") {
      status = "behind";
    } else if (body.status === "behind") {
      status = "ahead";
    } else if (body.status === "diverged") {
      status = "diverged";
    } else {
      status = "current";
    }

    return cachePut({
      status,
      branch: "main",
      localSha,
      remoteSha,
      behindBy,
      aheadBy,
      compareUrl,
    });
  } catch {
    return cachePut(unavailable("internal_error"));
  }
}
