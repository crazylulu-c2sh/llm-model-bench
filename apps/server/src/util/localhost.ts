import type { Context } from "hono";

const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
]);

const IPV4_LOOPBACK_RE = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV4_MAPPED_LOOPBACK_RE = /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i;

export function isLocalhostBaseUrl(input: string): boolean {
  if (!input || typeof input !== "string") return false;
  const trimmed = input.trim();
  if (!trimmed) return false;
  let url: URL;
  try {
    const candidate = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    url = new URL(candidate);
  } catch {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true;
  if (IPV4_LOOPBACK_RE.test(hostname)) return true;
  // IPv6 ::1 정규화 표현 (예: 0:0:0:0:0:0:0:1)
  if (hostname.includes(":")) {
    const compact = hostname.replace(/^\[/, "").replace(/\]$/, "");
    if (compact === "::1") return true;
    if (compact === "0:0:0:0:0:0:0:1") return true;
  }
  return false;
}

export function isLoopbackRemoteAddr(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const a = addr.trim().toLowerCase();
  if (!a) return false;
  if (a === "::1" || a === "0:0:0:0:0:0:0:1") return true;
  if (IPV4_LOOPBACK_RE.test(a)) return true;
  if (IPV4_MAPPED_LOOPBACK_RE.test(a)) return true;
  return false;
}

type RemoteAddrResolver = (c: Context) => string | null;

function defaultResolveRemoteAddr(c: Context): string | null {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined;
  const addr = env?.incoming?.socket?.remoteAddress;
  return typeof addr === "string" ? addr : null;
}

let remoteAddrResolver: RemoteAddrResolver = defaultResolveRemoteAddr;

export function getClientRemoteAddr(c: Context): string | null {
  return remoteAddrResolver(c);
}

export function _setRemoteAddrResolverForTest(fn: RemoteAddrResolver | null): void {
  remoteAddrResolver = fn ?? defaultResolveRemoteAddr;
}
