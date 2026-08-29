import { afterEach, describe, expect, it, vi } from "vitest";
import { providerFetch } from "./provider-fetch.js";
import {
  _resetWslHostFallbackCacheForTests,
  _setWslWindowsHostDepsForTest,
  rememberWslLoopbackFallback,
} from "./util/wsl-windows-host.js";

function hrefOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

afterEach(() => {
  vi.unstubAllGlobals();
  _setWslWindowsHostDepsForTest(null);
  _resetWslHostFallbackCacheForTests();
});

describe("providerFetch", () => {
  it("retries Windows host after loopback ECONNREFUSED in WSL", async () => {
    _setWslWindowsHostDepsForTest({ isWsl: () => true, readHost: () => "172.31.128.1" });
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = hrefOf(input);
      seen.push(url);
      if (url.includes("127.0.0.1")) {
        const err = new TypeError("fetch failed");
        (err as Error & { cause: { code: string } }).cause = { code: "ECONNREFUSED" };
        throw err;
      }
      return new Response("ok", { status: 200 });
    });

    const res = await providerFetch("http://127.0.0.1:11234/v1/models");
    expect(res.status).toBe(200);
    expect(seen).toEqual([
      "http://127.0.0.1:11234/v1/models",
      "http://172.31.128.1:11234/v1/models",
    ]);
  });

  it("skips localhost on a cached port", async () => {
    _setWslWindowsHostDepsForTest({ isWsl: () => true, readHost: () => "172.31.128.1" });
    rememberWslLoopbackFallback("http://127.0.0.1:11234/x");
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      seen.push(hrefOf(input));
      return new Response("ok", { status: 200 });
    });

    await providerFetch("http://127.0.0.1:11234/v1/models");
    expect(seen).toEqual(["http://172.31.128.1:11234/v1/models"]);
  });
});
