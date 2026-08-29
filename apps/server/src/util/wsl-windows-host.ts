import { readFileSync } from "node:fs";
import { isLocalhostBaseUrl } from "./localhost.js";

/**
 * WSL2 NAT에서 Windows 호스트(기본 게이트웨이) IP.
 * 대시보드 Base URL의 localhost는 WSL 루프백이라 Windows LM Studio에 닿지 않는다.
 * 프로바이더 fetch가 ECONNREFUSED면 이 호스트로 한 번 재시도한다.
 */

const FALLBACK_TTL_MS = 60_000;

type FallbackEntry = { host: string; expiresAt: number };

const fallbackByPort = new Map<number, FallbackEntry>();

let isWslFn = defaultIsWsl;
let readHostFn = defaultReadWindowsHostIp;

export function _setWslWindowsHostDepsForTest(
  deps: { isWsl?: () => boolean; readHost?: () => string | null } | null,
): void {
  isWslFn = deps?.isWsl ?? defaultIsWsl;
  readHostFn = deps?.readHost ?? defaultReadWindowsHostIp;
}

export function _resetWslHostFallbackCacheForTests(): void {
  fallbackByPort.clear();
}

export function defaultIsWsl(): boolean {
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

/** `/proc/net/route` 기본 게이트웨이 (리틀엔디안 hex → dotted IPv4). */
export function parseDefaultGatewayFromRouteTable(table: string): string | null {
  for (const line of table.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 3) continue;
    if (cols[1] !== "00000000") continue;
    const gw = cols[2];
    if (!gw || gw === "00000000") continue;
    const n = Number.parseInt(gw, 16);
    if (!Number.isFinite(n)) continue;
    const ip = `${n & 255}.${(n >> 8) & 255}.${(n >> 16) & 255}.${(n >> 24) & 255}`;
    if (ip === "0.0.0.0") continue;
    return ip;
  }
  return null;
}

export function defaultReadWindowsHostIp(): string | null {
  if (!isWslFn()) return null;
  try {
    return parseDefaultGatewayFromRouteTable(readFileSync("/proc/net/route", "utf8"));
  } catch {
    return null;
  }
}

export function readWindowsHostIp(): string | null {
  return readHostFn();
}

export function rewriteLoopbackHref(href: string, windowsHost: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!isLocalhostBaseUrl(url.origin)) return null;
  if (url.hostname === windowsHost) return null;
  url.hostname = windowsHost;
  return url.href;
}

function requestHref(input: RequestInfo | URL): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return null;
}

function applyHref(input: RequestInfo | URL, href: string): RequestInfo | URL {
  if (typeof input === "string") return href;
  if (input instanceof URL) return new URL(href);
  if (typeof Request !== "undefined" && input instanceof Request) {
    return new Request(href, input);
  }
  return input;
}

function portOfHref(href: string): number | null {
  try {
    const u = new URL(href);
    if (!isLocalhostBaseUrl(u.origin)) return null;
    const p = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    return Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

export function isConnectionRefused(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const rec = cur as { code?: unknown; cause?: unknown };
    if (rec.code === "ECONNREFUSED") return true;
    cur = rec.cause;
  }
  return false;
}

/**
 * WSL2에서 루프백 프로바이더 URL을 Windows 호스트로 바꿔 재시도할 대상을 고른다.
 * 캐시된 포트는 localhost를 건너뛴다(거절 왕복 비용). TTL 후 다시 localhost를 먼저 시도.
 */
export function resolveProviderFetchTarget(input: RequestInfo | URL): {
  first: RequestInfo | URL;
  fallback: RequestInfo | URL | null;
} {
  const href = requestHref(input);
  if (!href || !isWslFn()) return { first: input, fallback: null };
  const host = readHostFn();
  if (!host) return { first: input, fallback: null };
  const rewritten = rewriteLoopbackHref(href, host);
  if (!rewritten) return { first: input, fallback: null };

  const port = portOfHref(href);
  const cached = port != null ? fallbackByPort.get(port) : undefined;
  if (cached && cached.expiresAt > Date.now() && cached.host === host) {
    return { first: applyHref(input, rewritten), fallback: null };
  }
  return { first: input, fallback: applyHref(input, rewritten) };
}

export function rememberWslLoopbackFallback(input: RequestInfo | URL): void {
  const href = requestHref(input);
  if (!href) return;
  const port = portOfHref(href);
  const host = readHostFn();
  if (port == null || !host) return;
  fallbackByPort.set(port, { host, expiresAt: Date.now() + FALLBACK_TTL_MS });
}

export function forgetWslLoopbackFallback(input: RequestInfo | URL): void {
  const href = requestHref(input);
  if (!href) return;
  const port = portOfHref(href);
  if (port != null) fallbackByPort.delete(port);
}
