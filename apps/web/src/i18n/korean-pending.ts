// 하드코딩 한국어가 아직 남은 apps/web/src 파일들(no-hardcoded-korean 래칫의 기준선).
// 각 클러스터 스윕이 자기 파일을 이 목록에서 제거한다. Phase 7에서 빈 배열이 되면 마이그레이션 완료.
// 목록 밖 파일에 한국어가 생기면(회귀) 실패하고, 목록 안 파일에서 한국어가 사라지면(축소 누락) 실패한다.
// 잔여: 하네스 문서(Phase 6 — md 로케일 분리 후 제거).
export const KNOWN_PENDING: readonly string[] = [
  "HarnessDocPage.tsx",
];
