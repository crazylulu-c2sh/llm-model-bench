import type { Context, MiddlewareHandler } from "hono";
import { timingSafeEqual } from "node:crypto";
import { getClientRemoteAddr, isLoopbackRemoteAddr } from "../util/localhost.js";

/**
 * Bench 서버 API 키 인증(opt-in).
 *
 * 정책:
 * - `BENCH_API_KEYS`(콤마 리스트) 미설정 → 인증 비활성(현행 무설정 UX 유지).
 * - 면제(순서): OPTIONS(프리플라이트) → `/api/health`·`/api/v1/health` → 루프백(신뢰 프록시 포함) → 그 외 유효 키 필요.
 * - 자격증명: `Authorization: Bearer <key>` 또는 `x-api-key: <key>`. timingSafeEqual 비교.
 *
 * 이 키(헤더)는 provider apiKey(요청 body, 업스트림 LLM용)와 **완전히 별개**다 — 미들웨어는 헤더만 읽고
 * body.apiKey는 절대 참조하지 않으며, 인바운드 Authorization은 업스트림으로 포워딩되지 않는다.
 */

function parseKeys(env: string | undefined): Set<string> {
  if (!env) return new Set();
  return new Set(
    env
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** 후보 키를 저장된 키 집합과 상수시간 비교(early-return 타이밍 누수 방지). */
function keySetMatches(keys: Set<string>, candidate: string): boolean {
  const cand = Buffer.from(candidate);
  let ok = false;
  for (const k of keys) {
    const kb = Buffer.from(k);
    if (kb.length === cand.length && timingSafeEqual(kb, cand)) ok = true;
  }
  return ok;
}

function trustProxyEnabled(): boolean {
  const v = process.env.BENCH_TRUST_PROXY;
  return v === "1" || v === "true";
}

/**
 * 신원 판정용 remote 주소.
 * 기본은 소켓 peer(getClientRemoteAddr — XFF 무시, 스푸핑 방지). `BENCH_TRUST_PROXY=1`일 때만
 * 앞단 신뢰 프록시가 세팅한 `X-Real-IP`/`X-Forwarded-For`(마지막 hop)를 신뢰한다.
 * (모니터 lms 게이트는 여전히 raw getClientRemoteAddr를 써 엄격함을 유지 — 여긴 인증 전용.)
 */
function effectiveRemoteAddr(c: Context): string | null {
  if (trustProxyEnabled()) {
    const xri = c.req.header("x-real-ip");
    if (xri && xri.trim()) return xri.trim();
    const xff = c.req.header("x-forwarded-for");
    if (xff && xff.trim()) return xff.split(",")[0]!.trim();
  }
  return getClientRemoteAddr(c);
}

function extractKey(c: Context): string | null {
  const auth = c.req.header("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1]!.trim();
  }
  const xk = c.req.header("x-api-key");
  if (xk && xk.trim()) return xk.trim();
  return null;
}

/**
 * 요청이 유효한 `BENCH_API_KEYS` 키를 제시했는지(원격 모델 관리 게이트 전용).
 *
 * 미들웨어 `benchApiKeyAuth`와 달리 **fail-closed**: `BENCH_API_KEYS` 미설정이면 항상 false.
 * (미들웨어는 미설정 시 "인증 비활성=통과"지만, 원격 관리 경로는 키가 없으면 절대 허용하지 않는다.)
 * 헤더만 읽는다 — `Authorization: Bearer` 또는 `x-api-key`, timingSafeEqual 비교.
 */
export function hasValidBenchApiKey(c: Context): boolean {
  const keys = parseKeys(process.env.BENCH_API_KEYS);
  if (keys.size === 0) return false;
  const key = extractKey(c);
  return !!key && keySetMatches(keys, key);
}

export function benchApiKeyAuth(): MiddlewareHandler {
  return async (c, next) => {
    const keys = parseKeys(process.env.BENCH_API_KEYS);
    if (keys.size === 0) return next(); // 인증 비활성

    if (c.req.method === "OPTIONS") return next(); // CORS 프리플라이트

    const path = c.req.path;
    if (path === "/api/health" || path === "/api/v1/health") return next();

    const trustLoopback = process.env.BENCH_TRUST_LOOPBACK !== "0";
    if (trustLoopback && isLoopbackRemoteAddr(effectiveRemoteAddr(c))) return next();

    const key = extractKey(c);
    if (key && keySetMatches(keys, key)) return next();

    return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  };
}
