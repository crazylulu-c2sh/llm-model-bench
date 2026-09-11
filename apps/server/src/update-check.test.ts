import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForUpdate,
  _clearUpdateCheckCacheForTest,
  _setExecFileForTest,
  _setFetchForTest,
  _setNowForTest,
} from "./update-check.js";

const LOCAL_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REMOTE_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function mockGitMain(sha = LOCAL_SHA) {
  _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
    void file;
    void opts;
    const joined = (args as string[]).join(" ");
    if (joined.includes("rev-parse --abbrev-ref HEAD")) {
      cb(null, "main\n", "");
      return;
    }
    if (joined.endsWith("rev-parse HEAD") || /rev-parse [0-9a-f]{40}$/i.test(joined)) {
      cb(null, `${sha}\n`, "");
      return;
    }
    // last token HEAD without --abbrev-ref
    if ((args as string[]).includes("rev-parse") && (args as string[]).at(-1) === "HEAD") {
      cb(null, `${sha}\n`, "");
      return;
    }
    cb(new Error(`unexpected git args: ${joined}`), "", "");
  }) as typeof import("node:child_process").execFile);
}

function mockGitBranch(branch: string) {
  _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
    void file;
    void opts;
    const list = args as string[];
    if (list.includes("--abbrev-ref")) {
      cb(null, `${branch}\n`, "");
      return;
    }
    cb(null, `${LOCAL_SHA}\n`, "");
  }) as typeof import("node:child_process").execFile);
}

function mockGitMissing() {
  _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
    void file;
    void args;
    void opts;
    const err = Object.assign(new Error("not a git repo"), { code: 128 });
    cb(err, "", "fatal: not a git repository");
  }) as typeof import("node:child_process").execFile);
}

afterEach(() => {
  _setExecFileForTest(null);
  _setFetchForTest(null);
  _setNowForTest(null);
  _clearUpdateCheckCacheForTest();
  delete process.env.GITHUB_REPO;
  delete process.env.GITHUB_TOKEN;
});

describe("checkForUpdate", () => {
  beforeEach(() => {
    _clearUpdateCheckCacheForTest();
  });

  it("no git → unavailable", async () => {
    mockGitMissing();
    _setFetchForTest(vi.fn());
    const r = await checkForUpdate();
    expect(r.status).toBe("unavailable");
    expect(r.reason).toBe("no_git");
  });

  it("feature branch → not_main", async () => {
    mockGitBranch("feature/x");
    const fetch = vi.fn();
    _setFetchForTest(fetch);
    const r = await checkForUpdate();
    expect(r).toMatchObject({ status: "not_main", branch: "feature/x" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("detached HEAD → not_main", async () => {
    mockGitBranch("HEAD");
    const r = await checkForUpdate();
    expect(r.status).toBe("not_main");
    expect(r.reason).toBe("detached_head");
  });

  it("behind → behind with behindBy from GitHub ahead_by", async () => {
    mockGitMain();
    _setFetchForTest(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            status: "ahead",
            ahead_by: 3,
            behind_by: 0,
            commits: [{ sha: REMOTE_SHA }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const r = await checkForUpdate();
    expect(r.status).toBe("behind");
    expect(r.behindBy).toBe(3);
    expect(r.aheadBy).toBe(0);
    expect(r.localSha).toBe(LOCAL_SHA);
    expect(r.remoteSha).toBe(REMOTE_SHA);
    expect(r.compareUrl).toContain(`${LOCAL_SHA}...main`);
  });

  it("identical → current", async () => {
    mockGitMain();
    _setFetchForTest(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "identical", ahead_by: 0, behind_by: 0, commits: [] }), {
            status: 200,
          }),
      ),
    );
    const r = await checkForUpdate();
    expect(r.status).toBe("current");
    expect(r.behindBy).toBe(0);
  });

  it("local ahead → ahead", async () => {
    mockGitMain();
    _setFetchForTest(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "behind", ahead_by: 0, behind_by: 2, commits: [] }), {
            status: 200,
          }),
      ),
    );
    const r = await checkForUpdate();
    expect(r.status).toBe("ahead");
    expect(r.aheadBy).toBe(2);
  });

  it("diverged with behindBy > 0", async () => {
    mockGitMain();
    _setFetchForTest(
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: "diverged",
              ahead_by: 5,
              behind_by: 1,
              commits: [{ sha: REMOTE_SHA }],
            }),
            { status: 200 },
          ),
      ),
    );
    const r = await checkForUpdate();
    expect(r.status).toBe("diverged");
    expect(r.behindBy).toBe(5);
    expect(r.aheadBy).toBe(1);
  });

  it("GitHub 404 → unavailable", async () => {
    mockGitMain();
    _setFetchForTest(vi.fn(async () => new Response("Not Found", { status: 404 })));
    const r = await checkForUpdate();
    expect(r.status).toBe("unavailable");
    expect(r.reason).toBe("github_http_404");
  });

  it("GitHub 503 → unavailable", async () => {
    mockGitMain();
    _setFetchForTest(vi.fn(async () => new Response("boom", { status: 503 })));
    const r = await checkForUpdate();
    expect(r).toMatchObject({ status: "unavailable", reason: "github_http_503" });
  });

  it("GitHub 429 → unavailable", async () => {
    mockGitMain();
    _setFetchForTest(vi.fn(async () => new Response("rate", { status: 429 })));
    const r = await checkForUpdate();
    expect(r.reason).toBe("github_http_429");
  });

  it("fetch reject ENOTFOUND → unavailable github_unreachable", async () => {
    mockGitMain();
    _setFetchForTest(
      vi.fn(async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      }),
    );
    const r = await checkForUpdate();
    expect(r).toMatchObject({ status: "unavailable", reason: "github_unreachable" });
  });

  it("AbortError → unavailable github_timeout", async () => {
    mockGitMain();
    _setFetchForTest(
      vi.fn(async () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      }),
    );
    const r = await checkForUpdate();
    expect(r).toMatchObject({ status: "unavailable", reason: "github_timeout" });
  });

  it("success result is cached for 1h", async () => {
    mockGitMain();
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "identical", ahead_by: 0, behind_by: 0 }), { status: 200 }),
    );
    _setFetchForTest(fetch);
    let t = 1_000_000;
    _setNowForTest(() => t);

    expect((await checkForUpdate()).status).toBe("current");
    expect(fetch).toHaveBeenCalledTimes(1);

    t += 30 * 60 * 1000;
    expect((await checkForUpdate()).status).toBe("current");
    expect(fetch).toHaveBeenCalledTimes(1);

    t += 31 * 60 * 1000;
    expect((await checkForUpdate()).status).toBe("current");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("failure is negatively cached for 5m only", async () => {
    mockGitMain();
    const fetch = vi.fn(async () => new Response("no", { status: 503 }));
    _setFetchForTest(fetch);
    let t = 1_000_000;
    _setNowForTest(() => t);

    expect((await checkForUpdate()).status).toBe("unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);

    t += 4 * 60 * 1000;
    expect((await checkForUpdate()).status).toBe("unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);

    t += 2 * 60 * 1000;
    expect((await checkForUpdate()).status).toBe("unavailable");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("GITHUB_TOKEN is sent as Bearer when set", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    mockGitMain();
    const fetch = vi.fn(async (url, init) => {
      expect(String(url)).toContain("api.github.com/repos/crazylulu-c2sh/llm-model-bench/compare/");
      const h = init?.headers as Record<string, string>;
      expect(h.Authorization).toBe("Bearer ghp_test");
      return new Response(JSON.stringify({ status: "identical", ahead_by: 0, behind_by: 0 }), {
        status: 200,
      });
    });
    _setFetchForTest(fetch);
    await checkForUpdate();
    expect(fetch).toHaveBeenCalled();
  });
});
