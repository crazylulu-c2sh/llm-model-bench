import type { ScenarioId } from "./scenarios-preview";

/** UI용: 시나리오 목적·품질 기준(서버 `scoreScenario`와 같은 맥락으로 유지) */
export type ScenarioBenchMeta = {
  purposeKo: string;
  criteriaKo: string;
  /** 문서 페이지: 사용자 메시지·주입값 설명 */
  promptNotesKo?: string;
  /** 문서 페이지: 노출 도구 요약(서버 `openAiToolsForScenario`와 맞출 것) */
  toolsSummaryKo?: string;
  /** 문서 페이지: chat_completions / messages 라우팅 설명 */
  routesKo?: string;
  /** 문서 페이지: 채점·실행 흐름 요지 */
  implementationKo?: string;
};

const META: Record<ScenarioId, ScenarioBenchMeta> = {
  chat_hello: {
    purposeKo: "짧은 요청에 대한 응답 지연·연결을 확인합니다.",
    criteriaKo: "응답 본문을 품질 평가하지 않습니다. 공백만 있는 빈 응답이면 실패, 그 외는 통과입니다.",
    promptNotesKo: "고정 짧은 인사/텍스트 요청입니다. 도구 없음.",
    toolsSummaryKo: "없음.",
    routesKo: "프로바이더가 지원하면 OpenAI Chat Completions와 Anthropic Messages 각각에서 동일 사용자 텍스트로 한 번씩 측정됩니다.",
    implementationKo: "스트림 완료 여부와 지연만 관심사이며, 본문은 비어 있지 않으면 됩니다.",
  },
  chat_ping: {
    purposeKo: "추가 짧은 요청에 대한 응답 지연·연결을 확인합니다.",
    criteriaKo: "응답 본문을 품질 평가하지 않습니다. 공백만 있는 빈 응답이면 실패, 그 외는 통과입니다.",
    promptNotesKo: "hello 다음 순서의 짧은 ping 스타일 요청입니다.",
    toolsSummaryKo: "없음.",
    routesKo: "chat_hello와 동일하게 양쪽 API 라우트가 가능하면 각각 실행됩니다.",
    implementationKo: "벤치 루프에서 시나리오 순서상 두 번째 가벼운 왕복입니다.",
  },
  code_sort_js: {
    purposeKo: "코드만 출력하도록 지시했을 때 펜스 코드 블록과 퀵소트 구현을 따르는지 봅니다.",
    criteriaKo:
      "마크다운 ```js … ``` 안에 sortNums(또는 동등), 퀵소트 단서(partition·pivot·quicksort 등)가 있고 `.sort(` 가 없으면 합격입니다.",
    promptNotesKo: "숫자 배열 퀵소트 구현을 ```js 펜스 안에만 제출하라는 시스템+유저 지시입니다.",
    toolsSummaryKo: "없음.",
    routesKo: "일반 텍스트 completion 스타일; 지원 라우트마다 별도 측정됩니다.",
    implementationKo: "서버가 출력 문자열에서 펜스·금지 API·퀵소트 키워드를 정규식/휴리스틱으로 검사합니다.",
  },
  code_sort_py: {
    purposeKo: "Python 코드만 펜스 블록으로 내도록 할 때 형식·퀵소트 구현을 봅니다.",
    criteriaKo:
      "```python … ``` 안에 def sort_nums, 퀵소트 단서(partition·pivot·quicksort 등)가 있고 `sorted(`·`.sort(` 가 없으면 합격입니다.",
    promptNotesKo: "JS 시나리오와 대응하는 Python 버전입니다.",
    toolsSummaryKo: "없음.",
    routesKo: "code_sort_js와 동일.",
    implementationKo: "Python 펜스와 함수명·내장 정렬 금지 규칙으로 채점합니다.",
  },
  chat_time_calendar: {
    purposeKo: "프롬프트에 주입된 기준 시각을 바탕으로 어제·오늘·내일 날짜를 맞게 말하는지 봅니다.",
    criteriaKo:
      "지정 타임존(기본 Asia/Seoul) 달력 기준 어제·오늘·내일의 YYYY-MM-DD 세 값이 모두 출력에 포함되면 합격입니다.",
    promptNotesKo:
      "벤치 실행 시점의 `referenceAt`(ISO)과 `calendarTimeZone`이 프롬프트에 포함됩니다. 미리보기는 문서/통계 화면에서 현재 시각·Asia/Seoul로 예시를 둡니다.",
    toolsSummaryKo: "없음.",
    routesKo: "일반 채팅 메시지; 양 라우트 지원 시 각각 측정.",
    implementationKo: "서버가 동일 기준 시각으로 기대 날짜 세 개를 계산해 부분 문자열 포함 여부로 판정합니다.",
  },
  tool_weather: {
    purposeKo: "날씨 질문에 대해 제공된 get_weather 도구를 호출하는지 봅니다.",
    criteriaKo: "응답/스트림에 get_weather 도구 호출 신호(JSON tool_calls 등)가 있으면 합격입니다.",
    promptNotesKo: "도시 날씨를 묻는 단일 턴 사용자 메시지입니다.",
    toolsSummaryKo:
      "OpenAI 형식: `get_weather(city: string)`. Anthropic 형식: 동일 이름·input_schema. 실제 HTTP 날씨 API는 호출하지 않고 호출 여부만 검사합니다.",
    routesKo: "도구 스키마가 붙은 chat / messages 요청.",
    implementationKo: "스트림 이벤트에서 tool_calls / tool_use 유사 패턴을 텍스트로 스캔해 합격을 판정합니다.",
  },
  structured_action: {
    purposeKo: "프로즈 없이 유효한 JSON 한 객체만 내도록 할 때 스키마 준수를 봅니다.",
    criteriaKo: '{"action":"문자열","confidence":0~1 숫자} 형태의 JSON이 파싱·검증되면 합격입니다.',
    promptNotesKo: "프로즈 없이 출력 전체가 하나의 JSON 객체여야 한다고 명시합니다.",
    toolsSummaryKo: "없음.",
    routesKo: "일반 텍스트 응답을 JSON으로 파싱 시도.",
    implementationKo: "사고 블록을 제거한 뒤 첫 유효 JSON 객체를 찾아 필드 타입·범위를 검증합니다.",
  },
  translate_nist_fips197_pdf_tools: {
    purposeKo: "도구 호출로 NIST FIPS 197 PDF 텍스트를 읽고, 한국어 요약을 생성하는지 봅니다.",
    criteriaKo:
      "fetch_pdf_text 도구가 실제로 호출되고, 사고 블록을 제외한 최종 응답에 한글이 있으며 그 길이가 1000자 미만이면 합격입니다.",
    promptNotesKo:
      "PDF URL은 벤치 메타의 `public_assets_origin`(또는 브라우저 origin) 아래 공개 자산 경로로 주어집니다. 일반 웹 페이지용 `fetch_url`과 PDF 전용 `fetch_pdf_text`를 구분하라는 지시가 포함됩니다.",
    toolsSummaryKo:
      "`fetch_url`: UTF-8 텍스트(비PDF). `fetch_pdf_text`: PDF에서 추출한 평문(잘림). 벤치 러너가 도구 실행기를 붙여 실제 GET/PDF 파싱을 수행합니다.",
    routesKo: "도구가 포함된 chat / messages.",
    implementationKo:
      "도구 호출 로그와 최종 어시스턴트 텍스트를 합쳐: fetch_pdf_text 호출 존재, 한글 포함, 길이 상한을 만족하는지 확인합니다.",
  },
  stress_ping: {
    purposeKo: "프로바이더 벤치 전용: 동시 사용자 부하 측정용 최소 ping 워크로드.",
    criteriaKo: "응답이 비어있지 않으면 통과. TPS·지연 비교에 사용합니다.",
    promptNotesKo: "기본 max_tokens 32. 동시 워커별 `ping (client {k})` 변형 가능.",
    toolsSummaryKo: "없음.",
    routesKo: "프로바이더 벤치에서 단일 라우트(chat_completions 우선)로만 측정.",
    implementationKo: "프로바이더 벤치 ramp-up 단계마다 워커가 반복 발사. 모델 벤치 탭에는 노출되지 않습니다.",
  },
  stress_short_reply: {
    purposeKo: "프로바이더 벤치 전용: 영어 한 문장 응답을 동시 사용자 부하로 비교.",
    criteriaKo: "응답이 비어있지 않으면 통과. 토큰 생성 부하를 조금 더 끌어내는 변형.",
    promptNotesKo: "기본 max_tokens 128. 동시 워커별 `(client {k})` 변형.",
    toolsSummaryKo: "없음.",
    routesKo: "프로바이더 벤치 단일 라우트.",
    implementationKo: "프로바이더 벤치 ramp-up 단계마다 반복 발사. 모델 벤치 탭 미노출.",
  },
  stress_short_reply_ko: {
    purposeKo: "프로바이더 벤치 전용: 한국어 한 문장 응답 부하 — 다국어 처리 비교용.",
    criteriaKo: "응답이 비어있지 않으면 통과. `script_match` 라벨로 실제 한국어 응답 비율을 확인.",
    promptNotesKo: "system/user 모두 한국어. 기본 max_tokens 128. `(클라이언트 {k})` 변형.",
    toolsSummaryKo: "없음.",
    routesKo: "프로바이더 벤치 단일 라우트.",
    implementationKo: "CJK 토큰화 효율 차이로 영어 워크로드 대비 TPS가 달라질 수 있음. 모델 벤치 탭 미노출.",
  },
  stress_short_reply_ja: {
    purposeKo: "프로바이더 벤치 전용: 일본어 한 문장 응답 부하 — 다국어 처리 비교용.",
    criteriaKo: "응답이 비어있지 않으면 통과. `script_match` 라벨로 실제 일본어(히라가나/가타카나) 응답 비율을 확인.",
    promptNotesKo: "system/user 모두 일본어. 기본 max_tokens 128. `(クライアント {k})` 변형.",
    toolsSummaryKo: "없음.",
    routesKo: "프로바이더 벤치 단일 라우트.",
    implementationKo: "히라가나·가타카나 비율로 *예상 외 응답* 식별. 채점에는 영향 없음. 모델 벤치 탭 미노출.",
  },
  stress_long_context: {
    purposeKo: "프로바이더 벤치 전용: 긴 컨텍스트(~2500 tok)로 prefill·KV 캐시·메모리 대역폭 한계 측정 (영어).",
    criteriaKo: "응답이 비어있지 않으면 통과. 1순위 지표는 TTFT(p50/p95) — 동시성 증가에 따라 폭증 지점을 관찰.",
    promptNotesKo: "system: 한 문장 요약 지시. user: 약 2500 토큰 영어 백과 텍스트 + 끝에 요약 지시. 기본 max_tokens 32. `(client {k})` 워커 변형.",
    toolsSummaryKo: "없음.",
    routesKo: "프로바이더 벤치 단일 라우트 (chat_completions 우선).",
    implementationKo:
      "권장 temperature 0, timeout ≥ 120s. Prefix caching이 있는 엔진(vLLM PagedAttention 등)은 공통 prefix를 캐시해 prefill을 amortize할 수 있음 — workerPromptSuffix off 또는 caching 미지원 엔진에서 측정 권장. 모델 벤치 탭 미노출.",
  },
  stress_long_context_ko: {
    purposeKo: "프로바이더 벤치 전용: 긴 컨텍스트(~2500 tok)로 prefill·KV 캐시·메모리 대역폭 한계 측정 (한국어).",
    criteriaKo: "응답이 비어있지 않으면 통과. `script_match`로 한국어 응답 비율 확인. 1순위 지표는 TTFT(p50/p95).",
    promptNotesKo: "system/user 모두 한국어 백과 텍스트(~2500 tok) + 끝에 요약 지시. 기본 max_tokens 32. `(클라이언트 {k})` 워커 변형.",
    toolsSummaryKo: "없음.",
    routesKo: "프로바이더 벤치 단일 라우트.",
    implementationKo:
      "권장 temperature 0, timeout ≥ 120s. CJK 토큰화 효율 차이로 영어 워크로드 대비 TTFT/TPS가 달라질 수 있음. Prefix caching 엔진은 공통 prefix를 amortize할 수 있어 부하 과소 측정 가능 — workerPromptSuffix off 또는 caching 미지원 엔진 권장. 모델 벤치 탭 미노출.",
  },
  stress_long_context_ja: {
    purposeKo: "프로바이더 벤치 전용: 긴 컨텍스트(~2500 tok)로 prefill·KV 캐시·메모리 대역폭 한계 측정 (일본어).",
    criteriaKo: "응답이 비어있지 않으면 통과. `script_match`로 일본어(히라가나/가타카나) 응답 비율 확인. 1순위 지표는 TTFT(p50/p95).",
    promptNotesKo: "system/user 모두 일본어 백과 텍스트(~2500 tok) + 끝에 요약 지시. 기본 max_tokens 32. `(クライアント {k})` 워커 변형.",
    toolsSummaryKo: "없음.",
    routesKo: "프로바이더 벤치 단일 라우트.",
    implementationKo:
      "권장 temperature 0, timeout ≥ 120s. CJK 토큰화로 영어 대비 TTFT/TPS 변동 가능. Prefix caching 엔진은 공통 prefix amortize 가능 — workerPromptSuffix off 또는 caching 미지원 엔진 권장. 모델 벤치 탭 미노출.",
  },
};

export function getScenarioBenchMeta(id: string): ScenarioBenchMeta | null {
  if ((id as ScenarioId) in META) return META[id as ScenarioId];
  return null;
}
