import { afterEach, describe, expect, it } from "vitest";
import {
  _resetWslHostFallbackCacheForTests,
  _setWslWindowsHostDepsForTest,
  isConnectionRefused,
  parseDefaultGatewayFromRouteTable,
  rememberWslLoopbackFallback,
  resolveProviderFetchTarget,
  rewriteLoopbackHref,
} from "./wsl-windows-host.js";

afterEach(() => {
  _setWslWindowsHostDepsForTest(null);
  _resetWslHostFallbackCacheForTests();
});

describe("parseDefaultGatewayFromRouteTable", () => {
  it("reads the default route gateway as dotted IPv4", () => {
    const table = [
      "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT",
      "eth0\t00000000\t01801FAC\t0003\t0\t0\t0\t00000000\t0\t0\t0",
    ].join("\n");
    expect(parseDefaultGatewayFromRouteTable(table)).toBe("172.31.128.1");
  });

  it("skips a zero gateway", () => {
    const table = "eth0 00000000 00000000 0003 0 0 0 00000000 0 0 0\n";
    expect(parseDefaultGatewayFromRouteTable(table)).toBeNull();
  });
});

describe("rewriteLoopbackHref", () => {
  it("rewrites localhost and 127.0.0.1, keeps path and port", () => {
    expect(rewriteLoopbackHref("http://localhost:11234/v1/models", "172.31.128.1")).toBe(
      "http://172.31.128.1:11234/v1/models",
    );
    expect(rewriteLoopbackHref("http://127.0.0.1:11234/api/v1/models", "172.31.128.1")).toBe(
      "http://172.31.128.1:11234/api/v1/models",
    );
  });

  it("leaves non-loopback hosts alone", () => {
    expect(rewriteLoopbackHref("http://10.0.0.5:1234/v1", "172.31.128.1")).toBeNull();
  });
});

describe("isConnectionRefused", () => {
  it("walks Error.cause for ECONNREFUSED", () => {
    const err = new TypeError("fetch failed");
    (err as Error & { cause: { code: string } }).cause = { code: "ECONNREFUSED" };
    expect(isConnectionRefused(err)).toBe(true);
    expect(isConnectionRefused(new TypeError("fetch failed"))).toBe(false);
  });
});

describe("resolveProviderFetchTarget", () => {
  it("does not rewrite outside WSL", () => {
    _setWslWindowsHostDepsForTest({ isWsl: () => false, readHost: () => "172.31.128.1" });
    const r = resolveProviderFetchTarget("http://localhost:11234/v1/models");
    expect(r.first).toBe("http://localhost:11234/v1/models");
    expect(r.fallback).toBeNull();
  });

  it("offers Windows host fallback for loopback in WSL", () => {
    _setWslWindowsHostDepsForTest({ isWsl: () => true, readHost: () => "172.31.128.1" });
    const r = resolveProviderFetchTarget("http://127.0.0.1:11234/v1/models");
    expect(r.first).toBe("http://127.0.0.1:11234/v1/models");
    expect(r.fallback).toBe("http://172.31.128.1:11234/v1/models");
  });

  it("uses cached Windows host and skips localhost", () => {
    _setWslWindowsHostDepsForTest({ isWsl: () => true, readHost: () => "172.31.128.1" });
    rememberWslLoopbackFallback("http://127.0.0.1:11234/x");
    const r = resolveProviderFetchTarget("http://127.0.0.1:11234/v1/models");
    expect(r.first).toBe("http://172.31.128.1:11234/v1/models");
    expect(r.fallback).toBeNull();
  });
});
