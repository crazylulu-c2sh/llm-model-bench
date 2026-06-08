import { afterEach, describe, expect, it } from "vitest";
import {
  _setLocalAddressesForTest,
  isLocalhostBaseUrl,
  isLoopbackRemoteAddr,
  isTargetOnServerHost,
} from "./localhost";

describe("isLocalhostBaseUrl", () => {
  it("matches common loopback forms", () => {
    expect(isLocalhostBaseUrl("http://localhost:1234")).toBe(true);
    expect(isLocalhostBaseUrl("http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLocalhostBaseUrl("http://[::1]:11434")).toBe(true);
    expect(isLocalhostBaseUrl("http://0.0.0.0:1234")).toBe(true);
    expect(isLocalhostBaseUrl("127.0.0.1")).toBe(true);
    expect(isLocalhostBaseUrl("https://127.5.6.7:443")).toBe(true);
  });

  it("rejects non-loopback hosts", () => {
    expect(isLocalhostBaseUrl("http://10.0.0.5:1234")).toBe(false);
    expect(isLocalhostBaseUrl("http://lm-studio.local:1234")).toBe(false);
    expect(isLocalhostBaseUrl("http://192.168.1.10:1234")).toBe(false);
    expect(isLocalhostBaseUrl("")).toBe(false);
    expect(isLocalhostBaseUrl("   ")).toBe(false);
    // @ts-expect-error 잘못된 타입은 false
    expect(isLocalhostBaseUrl(undefined)).toBe(false);
  });

  it("handles ipv6 ::1 long form", () => {
    expect(isLocalhostBaseUrl("http://[0:0:0:0:0:0:0:1]:1234")).toBe(true);
  });
});

describe("isLoopbackRemoteAddr", () => {
  it("matches loopback addresses", () => {
    expect(isLoopbackRemoteAddr("127.0.0.1")).toBe(true);
    expect(isLoopbackRemoteAddr("127.5.6.7")).toBe(true);
    expect(isLoopbackRemoteAddr("::1")).toBe(true);
    expect(isLoopbackRemoteAddr("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isLoopbackRemoteAddr("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackRemoteAddr("::FFFF:127.0.0.1")).toBe(true);
  });

  it("rejects non-loopback", () => {
    expect(isLoopbackRemoteAddr("10.0.0.5")).toBe(false);
    expect(isLoopbackRemoteAddr("::ffff:10.0.0.5")).toBe(false);
    expect(isLoopbackRemoteAddr("172.18.0.1")).toBe(false);
    expect(isLoopbackRemoteAddr(null)).toBe(false);
    expect(isLoopbackRemoteAddr(undefined)).toBe(false);
    expect(isLoopbackRemoteAddr("")).toBe(false);
  });
});

describe("isTargetOnServerHost", () => {
  afterEach(() => _setLocalAddressesForTest(null));

  it("matches loopback regardless of server interfaces", () => {
    _setLocalAddressesForTest(["192.168.0.50"]);
    expect(isTargetOnServerHost("http://localhost:1234")).toBe(true);
    expect(isTargetOnServerHost("http://127.0.0.1:1234")).toBe(true);
  });

  it("matches a target on one of the server's own interface IPs (LAN, non-loopback)", () => {
    // 서버 .50 → 대상 .50:1234 (포트 무관) ⇒ 동일 머신
    _setLocalAddressesForTest(["127.0.0.1", "192.168.0.50"]);
    expect(isTargetOnServerHost("http://192.168.0.50:1234")).toBe(true);
  });

  it("rejects a target on a different LAN machine even if private", () => {
    // 서버 .50 → 대상 .51:1234 (타 머신) ⇒ CLI 무효
    _setLocalAddressesForTest(["127.0.0.1", "192.168.0.50"]);
    expect(isTargetOnServerHost("http://192.168.0.51:1234")).toBe(false);
  });

  it("rejects public hosts and bad input", () => {
    _setLocalAddressesForTest(["192.168.0.50"]);
    expect(isTargetOnServerHost("http://api.example.com:443")).toBe(false);
    expect(isTargetOnServerHost("")).toBe(false);
    // @ts-expect-error 잘못된 타입은 false
    expect(isTargetOnServerHost(undefined)).toBe(false);
  });
});
