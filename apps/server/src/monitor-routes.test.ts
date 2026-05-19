import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetLmsCliCacheForTest,
  _setExecFileForTest,
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
  _setRemoteAddrResolverForTest(null);
  _resetLmsCliCacheForTest();
  _resetSystemInfoCacheForTest();
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

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
});
