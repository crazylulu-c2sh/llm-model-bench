// docs 네임스페이스 — 문서 페이지 크롬(시나리오 문서 등). 장문 프로즈(ProfileDoc)는 content 모듈로 분리.
export const docs = {
  // 비전 서브카테고리 코드 → 표시 라벨(shared visionSubcategory 코드로 매핑)
  visionSubcategory: {
    ocr: "OCR",
    count: "카운트",
    chart: "차트",
    meme: "밈",
    wireframe: "와이어프레임",
  },
  imageAlt: (category: string, id: string) => `${category} 시나리오 예시 이미지 (${id})`,

  scenarios: {
    heading: "벤치 시나리오 문서",
    intro:
      "벤치 화면의 시나리오 카드는 목적·합격 기준만 요약합니다. 여기서는 동일 메타데이터를 확장 필드로 풀고, 실제 벤치와 같은 규칙으로 생성되는",
    introPreviewTerm: "요청 미리보기",
    introTail:
      "(OpenAI/Anthropic 라우트별 JSON — 메시지·도구·멀티모달 포함)를 둡니다. 비전 시나리오는 입력 이미지 썸네일을 클릭하면 확대해 볼 수 있습니다.",
    tocAria: "시나리오 목차",
    toc: "목차",
    textGroup: (n: number) => `텍스트 (${n})`,
    visionGroup: (n: number) => `비전 (${n})`,
    agentGroup: (n: number) => `에이전트 (${n})`,
    textSection: "텍스트 시나리오",
    visionSection: "비전 시나리오",
    agentSection: "에이전트 시나리오",
    agentIntro:
      "멀티턴 도구 사용 루프. 단일-샷과 달리 여러 턴에 걸쳐 도구를 호출하고 최종 답을 낸다 — 빈-턴 정체·사고 예산 소진·도구 인자 충실도처럼 턴을 가로질러야 드러나는 결함을 측정한다. 모든 도구 응답은 mock이다.",

    // 시나리오 카드 필드 라벨
    purpose: "목적",
    criteria: "합격 / 불합격 기준",
    promptNotes: "프롬프트·주입",
    tools: "도구",
    routes: "API 라우트",
    implementation: "채점·실행",
    requestPreview: "프롬프트·요청 미리보기",
    previewIntro:
      "서버가 조립하는 upstream 본문과 동일한 구조입니다. `model`·최종 `max_tokens`·프로파일 샘플링은 UI/프로파일에서 추가되며, 여기서는 메시지·도구·멀티모달 파트만 표시합니다.",
    visionMaxTokensFloor: "비전 max_tokens floor",
    enlargeImageAria: (id: string) => `${id} 이미지 확대`,
    zoom: "확대",
    noDescription: "등록된 설명이 없습니다.",

    // 에이전트 카드(경량)
    agentCriteria: "합격 기준",
    agentRoutes: "라우트",
    noMetadata: "등록된 메타데이터 없음.",
  },

  // 하네스 문서 페이지 크롬(HarnessDocPage)
  harness: {
    canonicalLead: "다른 프로젝트 참고용 · 정본:",
    newWindow: " (새 창에서 열림)",
    tocAria: "이 페이지 목차",
    tocTitle: "이 페이지",
    backToTop: "맨 위로",
    footnoteLabel: "각주",
  },
};
