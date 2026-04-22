import type { ScenarioId } from "./scenarios-preview";

/** UI용: 시나리오 목적·품질 기준(서버 `scoreScenario`와 같은 맥락으로 유지) */
export type ScenarioBenchMeta = {
  purposeKo: string;
  criteriaKo: string;
};

const META: Record<ScenarioId, ScenarioBenchMeta> = {
  chat_hello: {
    purposeKo: "짧은 요청에 대한 응답 지연·연결을 확인합니다.",
    criteriaKo: "응답 본문을 품질 평가하지 않습니다. 공백만 있는 빈 응답이면 실패, 그 외는 통과입니다.",
  },
  chat_ping: {
    purposeKo: "추가 짧은 요청에 대한 응답 지연·연결을 확인합니다.",
    criteriaKo: "응답 본문을 품질 평가하지 않습니다. 공백만 있는 빈 응답이면 실패, 그 외는 통과입니다.",
  },
  code_sort_js: {
    purposeKo: "코드만 출력하도록 지시했을 때 펜스 코드 블록과 퀵소트 구현을 따르는지 봅니다.",
    criteriaKo:
      "마크다운 ```js … ``` 안에 sortNums(또는 동등), 퀵소트 단서(partition·pivot·quicksort 등)가 있고 `.sort(` 가 없으면 합격입니다.",
  },
  code_sort_py: {
    purposeKo: "Python 코드만 펜스 블록으로 내도록 할 때 형식·퀵소트 구현을 봅니다.",
    criteriaKo:
      "```python … ``` 안에 def sort_nums, 퀵소트 단서(partition·pivot·quicksort 등)가 있고 `sorted(`·`.sort(` 가 없으면 합격입니다.",
  },
  chat_time_calendar: {
    purposeKo: "프롬프트에 주입된 기준 시각을 바탕으로 어제·오늘·내일 날짜를 맞게 말하는지 봅니다.",
    criteriaKo:
      "지정 타임존(기본 Asia/Seoul) 달력 기준 어제·오늘·내일의 YYYY-MM-DD 세 값이 모두 출력에 포함되면 합격입니다.",
  },
  tool_weather: {
    purposeKo: "날씨 질문에 대해 제공된 get_weather 도구를 호출하는지 봅니다.",
    criteriaKo: "응답/스트림에 get_weather 도구 호출 신호(JSON tool_calls 등)가 있으면 합격입니다.",
  },
  structured_action: {
    purposeKo: "프로즈 없이 유효한 JSON 한 객체만 내도록 할 때 스키마 준수를 봅니다.",
    criteriaKo: '{"action":"문자열","confidence":0~1 숫자} 형태의 JSON이 파싱·검증되면 합격입니다.',
  },
  translate_nist_fips197_pdf_tools: {
    purposeKo: "도구 호출로 NIST FIPS 197 PDF 텍스트를 읽고, 한국어 요약을 생성하는지 봅니다.",
    criteriaKo:
      "fetch_pdf_text 도구가 실제로 호출되고, 사고 블록을 제외한 최종 응답에 한글이 있으며 그 길이가 1000자 미만이면 합격입니다.",
  },
};

export function getScenarioBenchMeta(id: string): ScenarioBenchMeta | null {
  if ((id as ScenarioId) in META) return META[id as ScenarioId];
  return null;
}
