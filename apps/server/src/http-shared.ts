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

/**
 * 문서화된 API 베이스 접미사(`/v1`, `/api/v0`, `/api/v1`)를 벗겨 오리진 루트를 얻는다.
 *
 * LM Studio 네이티브 REST는 `{origin}/api/v1/...` 에 있는데, 사용자가 입력하는 baseUrl은
 * OpenAI 호환 형식(`http://host:1234/v1`)이 문서화된 기본형이다. 벗기지 않으면
 * `/v1/api/v1/models` 를 때리게 되고, LM Studio는 모르는 경로에 404가 아니라
 * **200 + `{"error": ...}`** 를 돌려주므로 실패가 성공으로 둔갑한다.
 */
export function stripDocumentedApiBaseSuffix(u: string): string {
  const strip = (path: string): string => path.replace(/\/api\/v[01]$/i, "").replace(/\/v1$/i, "");
  try {
    const url = new URL(u);
    const path = url.pathname.replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
    url.pathname = strip(path) || "/";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return strip(u);
  }
}

/**
 * LM Studio가 모르는 경로에 돌려주는 `{"error": ...}` 봉투인지.
 *
 * 404가 아니라 200으로 오기 때문에 상태 코드만으로는 거를 수 없다. 기대한 페이로드가
 * 없고 최상위 `error` 문자열만 있으면 그 엔드포인트가 아닌 것으로 보고 다음 후보로 넘어간다.
 */
export function isErrorEnvelope(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  return typeof (parsed as { error?: unknown }).error === "string";
}
