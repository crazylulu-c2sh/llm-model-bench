import { EventEmitter } from "node:events";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetLmsCliCacheForTest,
  _setExecFileForTest,
  _setSpawnForTest,
} from "./lms-cli";
import {
  _resetSystemInfoCacheForTest,
  _setExecFileForTest as _setSystemInfoExecFileForTest,
} from "./system-info";
import { registerMonitorRoutes } from "./monitor-routes";
import { _setRemoteAddrResolverForTest } from "./util/localhost";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function makeApp(): Hono {
  const app = new Hono();
  registerMonitorRoutes(app);
  return app;
}

function jsonReq(url: string, body: unknown, method: "POST" | "GET" = "POST"): Request {
  if (method === "GET") {
    return new Request(url);
  }
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  _resetLmsCliCacheForTest();
  _resetSystemInfoCacheForTest();
  _setRemoteAddrResolverForTest(() => "127.0.0.1");
});

afterEach(() => {
  _setExecFileForTest(null);
  _setSystemInfoExecFileForTest(null);
  _setSpawnForTest(null);
  _setRemoteAddrResolverForTest(null);
  _resetLmsCliCacheForTest();
  _resetSystemInfoCacheForTest();
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: (signal?: NodeJS.Signals | number) => boolean;
};

function makeMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn().mockReturnValue(true);
  return child;
}

/**
 * SSE Response의 body를 reader로 한 chunk 받을 때까지 대기 — start() 발동을 보장.
 * 이후 collected lines를 push해서 검증하는 collector도 함께 반환.
 */
function readSse(res: Response): {
  collected: string[];
  consume: () => Promise<void>;
  close: () => void;
} {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const collected: string[] = [];
  let stopped = false;
  const consume = async () => {
    while (!stopped) {
      const { done, value } = await reader.read();
      if (done) return;
      const chunk = decoder.decode(value);
      for (const piece of chunk.split("\n\n")) {
        const m = piece.match(/^data: (.+)$/m);
        if (m) collected.push(m[1]);
      }
    }
  };
  return {
    collected,
    consume,
    close: () => {
      stopped = true;
      reader.cancel().catch(() => undefined);
    },
  };
}

describe("POST /api/monitor/snapshot — gating", () => {
  it("non-loopback client → soft-fail 200, system/gpu null, remoteLoopback false", async () => {
    _setRemoteAddrResolverForTest(() => "10.0.0.5");
    const app = makeApp();
    const res = await app.fetch(
      jsonReq("http://x/api/monitor/snapshot", {
        baseUrl: "http://127.0.0.1:1234",
        provider: "lm_studio",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.remoteLoopback).toBe(false);
    expect(body.system).toBeNull();
    expect(body.gpu).toBeNull();
    expect(body.reason).toContain("client_not_loopback");
  });

  it("non-loopback baseUrl → system/gpu null, reason set", async () => {
    _setRemoteAddrResolverForTest(() => "127.0.0.1");
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "",
    })) as unknown as typeof fetch;
    const app = makeApp();
    const res = await app.fetch(
      jsonReq("http://x/api/monitor/snapshot", {
        baseUrl: "http://10.0.0.5:11434",
        provider: "lm_studio",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.remoteLoopback).toBe(true);
    expect(body.localhost).toBe(false);
    expect(body.system).toBeNull();
    expect(body.reason).toContain("baseUrl_not_localhost");
  });

  it("non-loopback client + ENV on + HTTP fail → lms ps NOT called (allowCli=false)", async () => {
    _setRemoteAddrResolverForTest(() => "172.18.0.1");
    process.env.ENABLE_LMS_CLI = "1";
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
    })) as unknown as typeof fetch;
    let spawned = 0;
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      spawned += 1;
      cb?.(null, "[]", "");
      return {} as never;
    }) as never);
    const app = makeApp();
    const res = await app.fetch(
      jsonReq("http://x/api/monitor/snapshot", {
        baseUrl: "http://127.0.0.1:1234",
        provider: "lm_studio",
      }),
    );
    expect(res.status).toBe(200);
    expect(spawned).toBe(0);
    const body = await res.json();
    expect(body.provider.source).toBe("none");
  });

  it("loopback client + localhost baseUrl + HTTP ok → system populated, provider.source=http", async () => {
    process.env.ENABLE_LMS_CLI = "1";
    _setSystemInfoExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      cb?.(null, "0, GPU, 100, 10, 5\n", "");
      return {} as never;
    }) as never);
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          models: [{ key: "m1", loaded_instances: [{ id: "inst-1" }] }],
        }),
    })) as unknown as typeof fetch;
    const app = makeApp();
    const res = await app.fetch(
      jsonReq("http://x/api/monitor/snapshot", {
        baseUrl: "http://127.0.0.1:1234",
        provider: "lm_studio",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.remoteLoopback).toBe(true);
    expect(body.localhost).toBe(true);
    expect(body.system).not.toBeNull();
    expect(body.gpu?.available).toBe(true);
    expect(body.provider.source).toBe("http");
    expect(body.provider.loaded[0].id).toBe("inst-1");
  });

  it("invalid body → 400", async () => {
    const app = makeApp();
    const res = await app.fetch(
      jsonReq("http://x/api/monitor/snapshot", { bogus: 1 }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/monitor/lms/availability", () => {
  it("non-loopback → binary null", async () => {
    _setRemoteAddrResolverForTest(() => "10.0.0.5");
    process.env.ENABLE_LMS_CLI = "1";
    const app = makeApp();
    const res = await app.fetch(jsonReq("http://x/api/monitor/lms/availability", null, "GET"));
    const body = await res.json();
    expect(body.remoteLoopback).toBe(false);
    expect(body.binary).toBeNull();
  });

  it("loopback + env on → binary populated", async () => {
    process.env.ENABLE_LMS_CLI = "1";
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      cb?.(null, "lms 0.5.0\n", "");
      return {} as never;
    }) as never);
    const app = makeApp();
    const res = await app.fetch(jsonReq("http://x/api/monitor/lms/availability", null, "GET"));
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.binary?.ok).toBe(true);
    expect(body.binary?.version).toBe("lms 0.5.0");
  });
});

describe("POST /api/monitor/lms/load — hard 403", () => {
  it("non-loopback → 403", async () => {
    _setRemoteAddrResolverForTest(() => "10.0.0.5");
    process.env.ENABLE_LMS_CLI = "1";
    const app = makeApp();
    const res = await app.fetch(
      jsonReq("http://x/api/monitor/lms/load", {
        baseUrl: "http://127.0.0.1:1234",
        model: "foo",
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("remote_not_loopback");
  });

  it("env off → 403 lms_cli_disabled", async () => {
    delete process.env.ENABLE_LMS_CLI;
    const app = makeApp();
    const res = await app.fetch(
      jsonReq("http://x/api/monitor/lms/load", {
        baseUrl: "http://127.0.0.1:1234",
        model: "foo",
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("lms_cli_disabled");
  });

  it("invalid model → 400", async () => {
    process.env.ENABLE_LMS_CLI = "1";
    const app = makeApp();
    const res = await app.fetch(
      jsonReq("http://x/api/monitor/lms/load", {
        baseUrl: "http://127.0.0.1:1234",
        model: "evil; rm -rf /",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_model_id");
  });

  it("non-localhost baseUrl → 400 not_localhost", async () => {
    process.env.ENABLE_LMS_CLI = "1";
    const app = makeApp();
    const res = await app.fetch(
      jsonReq("http://x/api/monitor/lms/load", {
        baseUrl: "http://10.0.0.5:1234",
        model: "ok-model",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("not_localhost");
  });

  it("success → calls lms load with correct args", async () => {
    process.env.ENABLE_LMS_CLI = "1";
    let captured: string[] | null = null;
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      captured = [...(args as string[])];
      cb?.(null, "loaded\n", "");
      return {} as never;
    }) as never);
    const app = makeApp();
    const res = await app.fetch(
      jsonReq("http://x/api/monitor/lms/load", {
        baseUrl: "http://127.0.0.1:1234",
        model: "publisher/model-name",
      }),
    );
    expect(res.status).toBe(200);
    expect(captured).toEqual(["load", "publisher/model-name"]);
  });
});

describe("POST /api/monitor/lms/unload — same gates", () => {
  it("non-loopback → 403", async () => {
    _setRemoteAddrResolverForTest(() => "10.0.0.5");
    process.env.ENABLE_LMS_CLI = "1";
    const app = makeApp();
    const res = await app.fetch(
      jsonReq("http://x/api/monitor/lms/unload", {
        baseUrl: "http://127.0.0.1:1234",
        model: "foo",
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/monitor/lms/log-stream", () => {
  it("non-loopback → 403", async () => {
    _setRemoteAddrResolverForTest(() => "10.0.0.5");
    const app = makeApp();
    const res = await app.fetch(
      jsonReq("http://x/api/monitor/lms/log-stream?baseUrl=http%3A%2F%2F127.0.0.1%3A1234", null, "GET"),
    );
    expect(res.status).toBe(403);
  });

  it("non-localhost baseUrl → 400", async () => {
    process.env.ENABLE_LMS_CLI = "1";
    const app = makeApp();
    const res = await app.fetch(
      jsonReq("http://x/api/monitor/lms/log-stream?baseUrl=http%3A%2F%2F10.0.0.5%3A1234", null, "GET"),
    );
    expect(res.status).toBe(400);
  });

  it("env off → 403", async () => {
    delete process.env.ENABLE_LMS_CLI;
    const app = makeApp();
    const res = await app.fetch(
      jsonReq("http://x/api/monitor/lms/log-stream?baseUrl=http%3A%2F%2F127.0.0.1%3A1234", null, "GET"),
    );
    expect(res.status).toBe(403);
  });

  it("releases activeLogClients counter on child close (재연결 가능)", async () => {
    process.env.ENABLE_LMS_CLI = "1";
    const children: MockChild[] = [];
    _setSpawnForTest(((_file: any, _args: any, _opts: any) => {
      const c = makeMockChild();
      children.push(c);
      return c as any;
    }) as never);
    const app = makeApp();
    const url = "http://x/api/monitor/lms/log-stream?baseUrl=http%3A%2F%2F127.0.0.1%3A1234";

    // 1차 연결 — stream consume + child close
    const res1 = await app.fetch(jsonReq(url, null, "GET"));
    expect(res1.status).toBe(200);
    const sse1 = readSse(res1);
    const consumePromise = sse1.consume();
    // start()가 발동될 때까지 한 tick 대기 + child 이벤트 발사
    await new Promise((r) => setTimeout(r, 5));
    expect(children).toHaveLength(1);
    children[0].emit("close", 0);
    await consumePromise;
    expect(sse1.collected.some((d) => d.includes('"closed"'))).toBe(true);

    // 2차 연결 — 카운터가 해제됐다면 200, 누수면 409.
    const res2 = await app.fetch(jsonReq(url, null, "GET"));
    expect(res2.status).toBe(200);
    const sse2 = readSse(res2);
    sse2.close();
  });

  it("returns 409 log_stream_busy on second concurrent connection", async () => {
    process.env.ENABLE_LMS_CLI = "1";
    const children: MockChild[] = [];
    _setSpawnForTest(((_file: any, _args: any, _opts: any) => {
      const c = makeMockChild();
      children.push(c);
      return c as any;
    }) as never);
    const app = makeApp();
    const url = "http://x/api/monitor/lms/log-stream?baseUrl=http%3A%2F%2F127.0.0.1%3A1234";

    // 라우트 핸들러는 동기로 counter += 1을 한 뒤 ReadableStream을 반환.
    // 따라서 첫 요청 응답이 200이면 카운터는 이미 1, 다음 요청은 409.
    const res1 = await app.fetch(jsonReq(url, null, "GET"));
    expect(res1.status).toBe(200);

    const res2 = await app.fetch(jsonReq(url, null, "GET"));
    expect(res2.status).toBe(409);
    expect((await res2.json()).error).toBe("log_stream_busy");

    // cleanup: 1차 child close → counter 해제 (다음 테스트 isolate)
    const sse1 = readSse(res1);
    const consume = sse1.consume();
    await new Promise((r) => setTimeout(r, 5));
    children[0]?.emit("close", 0);
    await consume;
  });

  it("releases counter when client aborts before consuming stream body", async () => {
    process.env.ENABLE_LMS_CLI = "1";
    let spawnCount = 0;
    _setSpawnForTest(((_file: any, _args: any, _opts: any) => {
      spawnCount += 1;
      return makeMockChild() as any;
    }) as never);
    const app = makeApp();
    const url = "http://x/api/monitor/lms/log-stream?baseUrl=http%3A%2F%2F127.0.0.1%3A1234";

    // 1차: 응답 받자마자 client abort (body 미소비). cancel()이 호출되지 않으므로
    // 라우트 핸들러의 c.req.raw.signal abort listener만이 release()를 트리거할 수 있다.
    const ac = new AbortController();
    const res1 = await app.fetch(new Request(url, { signal: ac.signal }));
    expect(res1.status).toBe(200);
    ac.abort();
    // abort listener는 microtask로 처리되므로 한 tick 대기.
    await new Promise((r) => setTimeout(r, 10));

    // 2차 연결이 200이면 counter가 해제된 것. 누수 시 409.
    const res2 = await app.fetch(jsonReq(url, null, "GET"));
    expect(res2.status).toBe(200);
    // 2차도 body를 정리.
    const sse2 = readSse(res2);
    sse2.close();
    // spawn은 1차에서 body 미소비라 start() 미발동 → 0회. 2차도 body 미소비.
    expect(spawnCount).toBeLessThanOrEqual(2);
  });

  it("buffers partial lines across chunk boundaries", async () => {
    process.env.ENABLE_LMS_CLI = "1";
    let captured: MockChild | null = null;
    _setSpawnForTest(((_file: any, _args: any, _opts: any) => {
      captured = makeMockChild();
      return captured as any;
    }) as never);
    const app = makeApp();
    const url = "http://x/api/monitor/lms/log-stream?baseUrl=http%3A%2F%2F127.0.0.1%3A1234";

    const res = await app.fetch(jsonReq(url, null, "GET"));
    expect(res.status).toBe(200);
    const sse = readSse(res);
    const consume = sse.consume();
    await new Promise((r) => setTimeout(r, 5));
    expect(captured).not.toBeNull();
    // "line1\nlin" 다음 "e2\nline3\n" — 중간이 잘려도 line2가 합쳐서 나와야 한다.
    captured!.stdout.emit("data", Buffer.from("line1\nlin"));
    captured!.stdout.emit("data", Buffer.from("e2\nline3\n"));
    await new Promise((r) => setTimeout(r, 5));
    captured!.emit("close", 0);
    await consume;

    const lines = sse.collected
      .map((d) => {
        try {
          return JSON.parse(d) as { type: string; line?: string };
        } catch {
          return null;
        }
      })
      .filter((j): j is { type: string; line?: string } => j != null && j.type === "line")
      .map((j) => j.line);
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });
});
