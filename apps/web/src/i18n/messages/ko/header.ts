// header 네임스페이스 — 상단 헤더(내비·부제목·테마/언어 스위처·벤치 진행률). ko가 진실의 원천.
export const header = {
  nav: {
    bench: "모델 벤치",
    stats: "모델 통계",
    stress: "프로바이더 벤치",
    providerStats: "프로바이더 통계",
    profile: "프로파일",
    monitor: "프로바이더 모니터",
    scenarios: "시나리오",
    harness: "하네스",
  },
  subtitle: {
    bench: "로컬 프로바이더 감지 · 단일 모델 시나리오 벤치",
    stats: "SQLite에 저장된 최신 런 기준 메트릭·결과",
    stress: "동시 사용자 부하 · 단계별 TPS · 라이브 워커 모니터",
    providerStats: "SQLite에 저장된 프로바이더 벤치 런 — 필터·익스포트·삭제",
    profile: "모델 패밀리별 샘플링·컨텍스트·런타임 적용 규칙",
    monitor: "로드된 모델 · 메모리·GPU 모니터 · lms CLI 조작",
    scenarios: "시나리오 목적·도구·채점·프롬프트 미리보기",
    harness: "벤치/스트레스 하네스 설계·기법 — 다른 프로젝트 참고용",
  },
  themeSelectAria: "테마 선택",
  themeDark: "다크",
  themeLight: "라이트",
  themeSystem: "시스템",
  languageSelectAria: "언어 선택",
  navAria: "주요 메뉴",
  benchProgress: (completed: number, total: number, pct: number) =>
    `벤치 실행 중 · ${completed}/${total} (${pct}%)`,
  benchProgressShort: "벤치 실행 중",
};
