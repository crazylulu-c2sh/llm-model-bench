import os from "node:os";
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

function defaultLocalAddresses(): Set<string> {
  const out = new Set<string>();
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const ni of list) {
      if (ni && typeof ni.address === "string" && ni.address.trim()) {
        out.add(ni.address.trim().toLowerCase());
      }
    }
  }
  return out;
}

let localAddressesProvider: () => Set<string> = defaultLocalAddresses;

export function _setLocalAddressesForTest(addrs: string[] | null): void {
  localAddressesProvider = addrs
    ? () => new Set(addrs.map((a) => a.trim().toLowerCase()))
    : defaultLocalAddresses;
}

/**
 * 대상 baseUrl 호스트가 *이 서버 프로세스가 도는 머신*인지 판정.
 * loopback이거나 서버의 네트워크 인터페이스 주소 중 하나와 일치하면 true.
 *
 * LM Studio `lms` CLI는 서버 머신의 로컬 LM Studio 인스턴스를 읽으므로, 대상이 동일
 * 머신일 때만 CLI 활성 신호가 유효하다. 단순 loopback/private 판정은 양방향 오류
 * (서버 .10 → 대상 .50 같은 타-머신 사설IP를 오인 허용)가 있어 인터페이스 매칭을 쓴다.
 */
export function isTargetOnServerHost(baseUrl: string): boolean {
  if (!baseUrl || typeof baseUrl !== "string") return false;
  if (isLocalhostBaseUrl(baseUrl)) return true;
  let host: string;
  try {
    const trimmed = baseUrl.trim();
    const candidate = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    host = new URL(candidate).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bare = host.replace(/^\[/, "").replace(/\]$/, "");
  const local = localAddressesProvider();
  return local.has(bare) || local.has(host);
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
