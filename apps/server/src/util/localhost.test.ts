import { describe, expect, it } from "vitest";
import { isLocalhostBaseUrl, isLoopbackRemoteAddr } from "./localhost";

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
