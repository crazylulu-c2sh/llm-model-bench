// 하드코딩 한국어가 아직 남은 apps/web/src 파일들(no-hardcoded-korean 래칫의 기준선).
// 마이그레이션 완료 → 빈 배열. 목록 밖 파일에 한국어가 생기면(회귀) 래칫이 실패한다.
// 정당한 예외(슬러그 id·endonym 등)는 `// i18n-ignore-next-line`로 개별 허용.
export const KNOWN_PENDING: readonly string[] = [];
