/**
 * 라우트 간 공유되는 작은 HTTP 유틸 — 라우트 팩토리(register.ts)와 catalog-routes.ts가 함께 쓴다.
 */

/** 클라이언트로 내보내는 SQLite 사용 불가 안내 — 원문 오류(DB 경로·errno)는 서버 로그에만 남긴다. */
export const SQLITE_PUBLIC_UNAVAILABLE_MSG =
  "SQLite를 사용할 수 없습니다. 서버 측 DB 경로·권한·잠금 상태를 확인하세요.";

/** trailing slash 제거 — base_url 정규화(서버 전역 동일 규칙). */
export const normBaseUrl = (u: string): string => u.replace(/\/+$/, "");
