// common 네임스페이스 — 앱 전반에서 공유하는 일반 UI 프리미티브. ko가 진실의 원천.
export const common = {
  confirm: "확인",
  cancel: "취소",
  close: "닫기",
  processing: "처리 중…",
  copy: "복사",
  copied: "복사됨",
  retry: "다시 시도",
  skipToContent: "본문 바로가기",
  codeScrollable: "코드 내용 (스크롤 가능)",
  syntaxHighlightLazy: "구문 강조 (lazy)",
  quantTitle: (quant: string) => `양자화 ${quant}`,
  // 백엔드/프로바이더 표시명 — LM Studio/Ollama는 고유명사(비번역), 나머지 2개만 로케일화.
  backendOpenaiCompatible: "OpenAI 호환",
  backendManual: "수동",
  errorBoundary: {
    title: "이 페이지를 표시하는 중 오류가 발생했습니다",
    body: "다른 탭으로 이동하면 계속 사용할 수 있습니다. 문제가 반복되면 아래 오류 내용과 함께 알려주세요.",
  },
};
