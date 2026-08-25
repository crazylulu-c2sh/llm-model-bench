/**
 * 라우트 간 공유되는 작은 HTTP 유틸 — 라우트 팩토리(register.ts)와 catalog-routes.ts가 함께 쓴다.
 */

/** 클라이언트로 내보내는 SQLite 사용 불가 안내 — 원문 오류(DB 경로·errno)는 서버 로그에만 남긴다. */
export const SQLITE_PUBLIC_UNAVAILABLE_MSG =
  "SQLite를 사용할 수 없습니다. 서버 측 DB 경로·권한·잠금 상태를 확인하세요.";

/** trailing slash 제거 — base_url 정규화(서버 전역 동일 규칙). */
export const normBaseUrl = (u: string): string => u.replace(/\/+$/, "");

/**
 * 프로바이더 호환성 캐시(Set)의 키 — 같은 서버를 다른 키로 잡지 않도록 대소문자까지 접는다.
 * openai-fetch의 stream_options 거부 캐시와 lmstudio의 JIT ttl 거부 캐시가 공유한다.
 * (표시·저장용 정규화는 normBaseUrl. 이쪽은 키 전용이므로 규칙이 갈리면 안 된다.)
 */
export const baseUrlCacheKey = (u: string): string => normBaseUrl(u).toLowerCase();
