import type { ScenarioId } from "./scenarios-preview";

/** UI용: 시나리오 목적·품질 기준(서버 `scoreScenario`와 같은 맥락으로 유지) */
export type ScenarioBenchMeta = {
  purposeKo: string;
  criteriaKo: string;
};

const META: Record<ScenarioId, ScenarioBenchMeta> = {
  chat_hello: {
    purposeKo: "짧은 고정 응답 지연·정확도를 확인합니다.",
    criteriaKo: "출력에 영어 단어 hello가 포함되면 합격입니다.",
  },
  chat_ping: {
    purposeKo: "다른 고정 토큰 응답 규칙 준수를 확인합니다.",
    criteriaKo: "출력에 소문자 pong이 포함되면 합격입니다.",
  },
  code_sort_js: {
    purposeKo: "코드만 출력하도록 지시했을 때 펜스 코드 블록과 함수 구현을 따르는지 봅니다.",
    criteriaKo: "마크다운 ```js … ``` 안에 sortNums(또는 동등)와 정렬(sort) 로직이 있으면 합격입니다.",
  },
  code_sort_py: {
    purposeKo: "Python 코드만 펜스 블록으로 내도록 할 때 형식·구현을 봅니다.",
    criteriaKo: "```python … ``` 안에 def sort_nums와 sorted/ sort 사용이 있으면 합격입니다.",
  },
  translate_bitcoin_pdf_tools: {
    purposeKo: "도구 호출로 PDF 텍스트를 읽고, 한국어 한 문장으로만 요약하는지 봅니다.",
    criteriaKo: "fetch_pdf_text 도구가 실제로 호출되고, 출력에 한글이 있으며 길이가 200자 미만이면 합격입니다.",
  },
  tool_weather: {
    purposeKo: "날씨 질문에 대해 제공된 get_weather 도구를 호출하는지 봅니다.",
    criteriaKo: "응답/스트림에 get_weather 도구 호출 신호(JSON tool_calls 등)가 있으면 합격입니다.",
  },
  structured_action: {
    purposeKo: "프로즈 없이 유효한 JSON 한 객체만 내도록 할 때 스키마 준수를 봅니다.",
    criteriaKo: '{"action":"문자열","confidence":0~1 숫자} 형태의 JSON이 파싱·검증되면 합격입니다.',
  },
};

export function getScenarioBenchMeta(id: string): ScenarioBenchMeta | null {
  if ((id as ScenarioId) in META) return META[id as ScenarioId];
  return null;
}
