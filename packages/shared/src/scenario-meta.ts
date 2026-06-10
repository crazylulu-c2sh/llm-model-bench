import type { ScenarioId } from "./scenarios-preview";

const VISION_ROUTES_KO =
  "비전 지원 모델만: OpenAI Chat Completions(image_url) / Anthropic Messages(image source). " +
  "loopback·사설망(RFC1918) origin은 자동 base64 인라인, 공개 origin은 URL.";

const VISION_JSON_EXTRACT_KO =
  "서버가 응답에서 fenced ```json``` 블록 우선 → 마지막 balanced `{...}` → 첫 balanced `{...}` 순으로 JSON 객체를 추출";

const JUDGE_OPS_KO =
  "(c) 켜는 방법: 환경변수 `LLM_JUDGE_ENABLED=1` + `ANTHROPIC_API_KEY` 둘 다 설정. " +
  "기본 judge 모델 `claude-opus-4-7` (`LLM_JUDGE_MODEL`로 교체 가능). 호출 스펙: temperature 0, timeout 30s, 재시도 0회.\n";

const MEME_PREFILTER_KO =
  "(b) 서버 prefilter (4종 모두 통과해야 judge로 진행):\n" +
  "  ① 한글 포함\n" +
  "  ② 서버·데이터센터 단서 (`서버`, `데이터센터`, `랙`, `server`, `datacenter`, `data center`)\n" +
  "  ③ 당나귀·수레 단서 (`당나귀`, `수레`, `짐마차`, `donkey`, `cart`)\n" +
  "  ④ 대비·기대·현실 단서 (`대비`, `차이`, `기대`, `현실`, `약속`, `실제`, `promise`, `reality`, `expect`, `expectation`)\n";

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
      "사고 블록 제거 후 ```js … ``` 펜스가 있으면 그 안의 코드를, 없으면 전체 본문을 채점합니다. " +
      "sortNums(또는 동등), 퀵소트 단서(partition·pivot·quicksort 등)가 있고 `.sort(` 가 없으면 합격입니다.",
    promptNotesKo:
      "system: ```js``` 펜스·no prose·내장 sort 금지. user: sortNums 퀵소트 구현 과제만(형식 지시는 system에만).",
    toolsSummaryKo: "없음.",
    routesKo: "일반 텍스트 completion 스타일; 지원 라우트마다 별도 측정됩니다.",
    implementationKo:
      "사고 블록 제거 후 ```js``` 펜스를 우선 추출하고, 펜스가 없으면 전체 본문으로 폴백한 뒤 금지 API·퀵소트 키워드를 검사합니다.",
  },
  code_sort_py: {
    purposeKo: "Python 코드만 펜스 블록으로 내도록 할 때 형식·퀵소트 구현을 봅니다.",
    criteriaKo:
      "사고 블록 제거 후 ```python … ``` 펜스가 있으면 그 안의 코드를, 없으면 전체 본문을 채점합니다. " +
      "def sort_nums, 퀵소트 단서(partition·pivot·quicksort 등)가 있고 `sorted(`·`.sort(` 가 없으면 합격입니다.",
    promptNotesKo:
      "code_sort_js와 동일 역할 분리 — system: ```python``` 펜스·형식, user: def sort_nums 퀵소트 과제만.",
    toolsSummaryKo: "없음.",
    routesKo: "code_sort_js와 동일.",
    implementationKo:
      "사고 블록 제거 후 ```python``` 펜스를 우선 추출하고, 펜스가 없으면 전체 본문으로 폴백한 뒤 함수명·내장 정렬 금지 규칙으로 채점합니다.",
  },
  chat_time_calendar: {
    purposeKo: "프롬프트에 주입된 기준 시각을 바탕으로 어제·오늘·내일 날짜를 맞게 말하는지 봅니다.",
    criteriaKo:
      "벤치 러너가 `Asia/Seoul`로 고정한 달력 기준 어제·오늘·내일의 YYYY-MM-DD 세 값이 모두 출력에 포함되면 합격입니다.",
    promptNotesKo:
      "벤치 실행 시점의 `referenceAt`(ISO)과 `calendarTimeZone`이 프롬프트에 포함됩니다. 미리보기는 문서/통계 화면에서 현재 시각·Asia/Seoul로 예시를 둡니다.",
    toolsSummaryKo: "없음.",
    routesKo: "일반 채팅 메시지; 양 라우트 지원 시 각각 측정.",
    implementationKo: "서버가 동일 기준 시각으로 기대 날짜 세 개를 계산해 부분 문자열 포함 여부로 판정합니다.",
  },
  tool_weather: {
    purposeKo: "날씨 질문에 대해 제공된 get_weather 도구를 호출하는지 봅니다.",
    criteriaKo:
      "응답 본문에 `get_weather` 문자열 언급(`\\bget_weather\\b`) 또는 JSON `tool_calls`/`\"name\":\"get_weather\"` 패턴이 있으면 합격입니다.",
    promptNotesKo: "도시 날씨를 묻는 단일 턴 사용자 메시지입니다.",
    toolsSummaryKo:
      "OpenAI 형식: `get_weather(city: string)`. Anthropic 형식: 동일 이름·input_schema. 실제 HTTP 날씨 API는 호출하지 않고 호출 여부만 검사합니다.",
    routesKo: "도구 스키마가 붙은 chat / messages 요청.",
    implementationKo:
      "완료된 출력 문자열을 정규식으로 스캔합니다(`get_weather` 단어·JSON tool_calls 패턴). 스트림 이벤트를 직접 파싱하지 않습니다.",
  },
  structured_action: {
    purposeKo: "프로즈 없이 유효한 JSON 한 객체만 내도록 할 때 스키마 준수를 봅니다.",
    criteriaKo: '{"action":"문자열","confidence":0~1 숫자} 형태의 JSON이 파싱·검증되면 합격입니다.',
    promptNotesKo:
      "system: JSON 스키마·형식(프로즈·펜스 금지). user: 분기 보고서 검토 후 submit/revise/hold 선택 과제.",
    toolsSummaryKo: "없음.",
    routesKo: "일반 텍스트 응답을 JSON으로 파싱 시도.",
    implementationKo:
      "사고 블록을 제거한 뒤 greedy `\\{[\\s\\S]*\\}` 1회 매칭으로 JSON을 추출하고 `JSON.parse`·스키마 검증합니다(복수 JSON·중첩 시 비전용 balanced 추출과 다름).",
  },
  vision_table_ocr_a: {
    purposeKo: "복잡한 재무 표 이미지에서 'Net Income' 행의 2024 Actual 값과 YoY 변화율을 정확히 추출하는지 평가합니다 (ChatGPT 생성 이미지).",
    criteriaKo:
      "정답: 'Net Income' 행의 2024 Actual = 2373.9, YoY = 11.3%. " +
      "채점: JSON `{net_income_2024, net_income_yoy_percent}` 출력. 두 키 모두 통과(값 2% 상대오차 / YoY 0.5%p 절대오차)면 rubric 3, 한쪽만 통과면 2, 둘 다 오차 밖이지만 파싱 OK면 1, JSON 파싱 실패 / 키 누락 / 거부 응답이면 0. pass는 score ≥ 0.67 (rubric ≥ 2).",
    promptNotesKo:
      "이미지에 'Net Income'과 'Net Income Attributable to Shareholders' 두 행이 별도 존재합니다 — 프롬프트는 정확한 'Net Income' 행을 요구합니다(case-insensitive 매칭 허용).",
    toolsSummaryKo: "없음. 이미지 1장이 user 메시지에 image_url(또는 base64) 파트로 포함됩니다.",
    routesKo: VISION_ROUTES_KO,
    implementationKo:
      `${VISION_JSON_EXTRACT_KO} → 두 키 모두 number로 정규화(콤마·$·% strip) → 오차 검사. 루브릭 0~3을 score 0~1로 매핑.`,
  },
  vision_table_ocr_b: {
    purposeKo: "복잡한 재무 표 이미지에서 'NET INCOME' 행의 2024 Actual 값과 YoY 변화율을 정확히 추출하는지 평가합니다 (Gemini 생성 이미지).",
    criteriaKo:
      "정답: 'NET INCOME' 행의 2024 Actual = 410.55, YoY = +20.7%. " +
      "채점: JSON `{net_income_2024, net_income_yoy_percent}` 출력. 두 키 모두 통과(값 2% 상대오차 / YoY 0.5%p 절대오차)면 rubric 3, 한쪽만 통과면 2, 둘 다 오차 밖이지만 파싱 OK면 1, JSON 파싱 실패 / 키 누락 / 거부 응답이면 0. pass는 score ≥ 0.67 (rubric ≥ 2).",
    promptNotesKo:
      "B 이미지는 AI 생성 아티팩트로 COGS·R&D·OPERATING INCOME 등 여러 행이 동일 숫자(410.55/+20.7%)를 공유합니다. v1 채점은 숫자만 보므로 *행 식별 실패*와 *정확 식별*을 구분하지 못합니다.",
    toolsSummaryKo: "없음. 이미지 1장이 user 메시지에 image_url(또는 base64) 파트로 포함됩니다.",
    routesKo: VISION_ROUTES_KO,
    implementationKo:
      `${VISION_JSON_EXTRACT_KO} → 두 키 모두 number로 정규화(콤마·$·% strip) → 오차 검사. 루브릭 0~3을 score 0~1로 매핑.`,
  },
  vision_count_red_cars_a: {
    purposeKo: "밀집된 항공 주차장 사진에서 빨간색 차량 수를 정확히 카운팅하는지 평가합니다 (ChatGPT 생성 이미지).",
    criteriaKo:
      "정답 범위: 31~37대 (사람이 직접 카운트). " +
      "채점: JSON `{red_cars: <integer>}` 출력. 범위 안이면 rubric 3, ±3대면 2, ±5대면 1, 그 외 / `red_cars = 0` / 100 이상 환각 / JSON 키 누락 / 거부 응답이면 0. pass는 score ≥ 0.67 (rubric ≥ 2).",
    promptNotesKo:
      "사람이 직접 카운트한 범위가 ground truth. 생성 모델 프롬프트는 '대략 15~20대'를 요구했지만 실제로는 두 이미지 모두 30대+ — 모델이 프롬프트 사양을 기억해서 답하면 0점으로 떨어집니다(이미지 인식 vs 사전지식 변별 신호).",
    toolsSummaryKo: "없음.",
    routesKo: VISION_ROUTES_KO,
    implementationKo:
      `${VISION_JSON_EXTRACT_KO} → red_cars 정수 변환 → 범위 단계 비교. 루브릭 0~3을 score 0~1로 매핑.`,
  },
  vision_count_red_cars_b: {
    purposeKo: "밀집된 항공 주차장 사진에서 빨간색 차량 수를 정확히 카운팅하는지 평가합니다 (Gemini 생성 이미지).",
    criteriaKo:
      "정답 범위: 40~48대 (사람이 직접 카운트). " +
      "채점: JSON `{red_cars: <integer>}` 출력. 범위 안이면 rubric 3, ±3대면 2, ±5대면 1, 그 외 / `red_cars = 0` / 100 이상 환각 / JSON 키 누락 / 거부 응답이면 0. pass는 score ≥ 0.67 (rubric ≥ 2).",
    promptNotesKo:
      "Gemini가 자체 이미지를 16/18~22로 자체 평가했지만 인간 카운트와 크게 어긋남 — 사용자 수동 카운트의 중요성을 입증.",
    toolsSummaryKo: "없음.",
    routesKo: VISION_ROUTES_KO,
    implementationKo:
      `${VISION_JSON_EXTRACT_KO} → red_cars 정수 변환 → 범위 단계 비교. 루브릭 0~3을 score 0~1로 매핑.`,
  },
  vision_chart_peak_a: {
    purposeKo: "다중 라인 차트에서 전체 최고점의 제품·분기·값을 추출하는지 평가합니다 (ChatGPT 생성 이미지).",
    criteriaKo:
      "정답: product = \"C\", quarter = \"Q2 2024\", value_percent = 45.8. " +
      "채점: JSON `{product, quarter, value_percent}` 출력. 세 조건 모두 통과면 rubric 3, 두 개면 2, 한 개면 1, 모두 실패 / JSON 파싱 실패 / 키 누락이면 0. value_percent는 ±1.5%p 허용. pass는 score ≥ 0.67 (rubric ≥ 2).",
    promptNotesKo:
      "A 이미지에는 'Peak Comparison (Q2 2024): Product C: 45.8%, Product A: 45.2%' 콜아웃 박스가 직접 적혀 있어 모델이 그래프 추론 없이 박스 텍스트 OCR만으로 만점 가능 — 순수 차트 해석과 텍스트 인식이 구분되지 않습니다.",
    toolsSummaryKo: "없음.",
    routesKo: VISION_ROUTES_KO,
    implementationKo:
      `${VISION_JSON_EXTRACT_KO} → product/quarter는 정규화(trim·대문자·\`Q2 2024\`/\`Q2'24\`/\`2024 Q2\` canonicalize) 후 exact 매칭, value_percent는 parseSignedPercent로 number 통일. 루브릭 0~3을 score 0~1로 매핑.`,
  },
  vision_chart_peak_b: {
    purposeKo: "다중 라인 차트에서 전체 최고점의 제품·분기·값을 추출하는지 평가합니다 (Gemini 생성 이미지).",
    criteriaKo:
      "정답: product = \"C\", quarter = \"Q2 2024\", value_percent = 62.4. " +
      "채점: JSON `{product, quarter, value_percent}` 출력. 세 조건 모두 통과면 rubric 3, 두 개면 2, 한 개면 1, 모두 실패 / JSON 파싱 실패 / 키 누락이면 0. value_percent는 ±1.5%p 허용. pass는 score ≥ 0.67 (rubric ≥ 2).",
    promptNotesKo:
      "참고: Product A 최고는 Q3 2024 / 61.1% (피크 비교 시 혼동 주의). 정답 62.4는 커서·Gemini 두 독립 리뷰가 모두 확정.",
    toolsSummaryKo: "없음.",
    routesKo: VISION_ROUTES_KO,
    implementationKo:
      `${VISION_JSON_EXTRACT_KO} → product/quarter는 정규화(trim·대문자·\`Q2 2024\`/\`Q2'24\`/\`2024 Q2\` canonicalize) 후 exact 매칭, value_percent는 parseSignedPercent로 number 통일. 루브릭 0~3을 score 0~1로 매핑.`,
  },
  vision_meme_explain_a: {
    purposeKo: "두 패널 밈의 시각적 대비와 풍자 의도를 한국어로 정확히 설명하는지 평가합니다 (ChatGPT 생성 이미지).",
    criteriaKo:
      "한 줄 요약: 정답 텍스트 고정 없음(주관 채점) · LLM-as-Judge 필수 · judge 비활성 시 최대 rubric 1 (score 0.33, pass=false).\n\n" +
      "(a) 왜 judge가 필요한가: 한국어 자유 서술 응답이라 결정론 채점 불가, 풍자 의도 해석은 외부 모델에 위임한다.\n" +
      MEME_PREFILTER_KO +
      JUDGE_OPS_KO +
      "(d) Judge 활성 시 rubric:\n" +
      "  • 3 = 두 패널 텍스트 인용 + 시각 묘사(서버 랙 vs 당나귀 수레) + \"LLM 클라우드 약속 vs 로컬 PC 현실\" 풍자 의도 모두 정확.\n" +
      "  • 2 = OCR·시각은 정확하나 기술 맥락(LLM/PC 연결) 약함.\n" +
      "  • 1 = 묘사만 하고 '왜 웃긴지' 미설명.\n" +
      "  • 0 = OCR 실패 / 무관한 설명.\n" +
      "(e) Judge 실패(timeout 30s / parse error / 5xx / API 키 없음): rubric 0 + reason에 `judge_timeout` / `judge_parse_error` / `judge_network_error` 라벨. pass는 score ≥ 0.67 (rubric ≥ 2).",
    promptNotesKo:
      "A는 상하 분할, B는 좌우 분할. system: 한국어·3~5문장·패널 구체성. user: 풍자·패널 대비 태스크만.",
    toolsSummaryKo: "없음.",
    routesKo: VISION_ROUTES_KO,
    implementationKo:
      "scoreScenario는 prefilter + 잠정 rubric 1만 산출(내부 `judge_pending` 플래그). bench-runner가 judge enable + prefilter 통과 시 Claude Opus 4.7 호출 후 0~3 rubric으로 덮어쓴다. judge 실패는 rubric 0. emit 직전 `judge_pending` 플래그는 SSE/DB에서 제거.",
  },
  vision_meme_explain_b: {
    purposeKo: "두 패널 밈의 시각적 대비와 풍자 의도를 한국어로 정확히 설명하는지 평가합니다 (Gemini 생성 이미지).",
    criteriaKo:
      "한 줄 요약: 정답 텍스트 고정 없음(주관 채점) · LLM-as-Judge 필수 · judge 비활성 시 최대 rubric 1 (score 0.33, pass=false).\n\n" +
      "(a) 왜 judge가 필요한가: 한국어 자유 서술 응답이라 결정론 채점 불가, 풍자 의도 해석은 외부 모델에 위임한다.\n" +
      MEME_PREFILTER_KO +
      JUDGE_OPS_KO +
      "(d) Judge 활성 시 rubric:\n" +
      "  • 3 = 두 패널 텍스트 인용 + 시각 묘사(서버 랙 vs 당나귀 수레) + \"LLM 클라우드 약속 vs 로컬 PC 현실\" 풍자 의도 모두 정확.\n" +
      "  • 2 = OCR·시각은 정확하나 기술 맥락(LLM/PC 연결) 약함.\n" +
      "  • 1 = 묘사만 하고 '왜 웃긴지' 미설명.\n" +
      "  • 0 = OCR 실패 / 무관한 설명.\n" +
      "(e) Judge 실패(timeout 30s / parse error / 5xx / API 키 없음): rubric 0 + reason에 `judge_timeout` / `judge_parse_error` / `judge_network_error` 라벨. pass는 score ≥ 0.67 (rubric ≥ 2).",
    promptNotesKo:
      "B는 가로 분할(좌우). vision_meme_explain_a와 동일 프롬프트·역할 분리(스타일은 system, 태스크는 user).",
    toolsSummaryKo: "없음.",
    routesKo: VISION_ROUTES_KO,
    implementationKo:
      "scoreScenario는 prefilter + 잠정 rubric 1만 산출(내부 `judge_pending` 플래그). bench-runner가 judge enable + prefilter 통과 시 Claude Opus 4.7 호출 후 0~3 rubric으로 덮어쓴다. judge 실패는 rubric 0. emit 직전 `judge_pending` 플래그는 SSE/DB에서 제거.",
  },
  vision_wireframe_html_a: {
    purposeKo: "손그림 와이어프레임 이미지를 시맨틱 HTML5 + Tailwind로 재구성하는지 평가합니다 (ChatGPT 생성 이미지).",
    criteriaKo:
      "한 줄 요약: 정답 HTML 고정 없음(구조 일치 채점) · LLM-as-Judge 필수 · judge 비활성 시 최대 rubric 1 (score 0.33, pass=false).\n\n" +
      "(a) 왜 judge가 필요한가: HTML 텍스트가 다양해 결정론 비교 불가, 레이아웃·요소 재현은 judge가 시각 비교한다.\n" +
      "(b) 서버 prefilter (모두 case-insensitive 통과해야 judge로 진행):\n" +
      "  ① ```html``` 펜스 또는 일반 ``` 코드 펜스 존재\n" +
      "  ② 시맨틱 태그(<header>·<nav>·<main>·<section>·<footer>) 중 3개 이상\n" +
      "  ③ 필수 단서 `Sign Up`, `Learn More`, `Feature` 모두 포함\n" +
      JUDGE_OPS_KO +
      "(d) Judge 활성 시 rubric:\n" +
      "  • 3 = grid/flex 사용, 모든 라벨 섹션이 올바른 수직 순서, 라벨된 요소(버튼·내비·폼 필드) 모두 재현.\n" +
      "  • 2 = 레이아웃 대체로 맞으나 정렬 어긋남 또는 1~2개 사소한 누락.\n" +
      "  • 1 = 단일 컬럼으로 무너짐 OR 핵심 버튼·내비 누락.\n" +
      "  • 0 = 코드 생성 거부 / 무관한 코드.\n" +
      "(e) Judge 실패(timeout 30s / parse error / 5xx / API 키 없음): rubric 0 + reason에 `judge_timeout` / `judge_parse_error` / `judge_network_error` 라벨. 비전 미지원 모델 400은 `upstream_no_vision`으로 별도 라벨. pass는 score ≥ 0.67 (rubric ≥ 2).",
    promptNotesKo:
      "A 와이어프레임: Header(Logo+Nav 5개), Hero(Sign Up+Learn More), Features Grid 3개, Testimonials, Footer 4열. " +
      "system: semantic HTML5·Tailwind·```html``` 펜스. user: 와이어프레임 재구성·라벨 유지 과제만.",
    toolsSummaryKo: "없음.",
    routesKo: `${VISION_ROUTES_KO} 기본 max_tokens 4096(긴 HTML 출력).`,
    implementationKo:
      "scoreScenario: 펜스 추출 + substring 매칭(prefilter, case-insensitive) + 잠정 rubric 1(`judge_pending` 플래그). bench-runner가 judge enable + prefilter 통과 시 Claude Opus 4.7 호출 후 0~3 rubric으로 덮어쓴다. judge 실패는 rubric 0.",
  },
  vision_wireframe_html_b: {
    purposeKo: "손그림 와이어프레임 이미지를 시맨틱 HTML5 + Tailwind로 재구성하는지 평가합니다 (Gemini 생성 이미지).",
    criteriaKo:
      "한 줄 요약: 정답 HTML 고정 없음(구조 일치 채점) · LLM-as-Judge 필수 · judge 비활성 시 최대 rubric 1 (score 0.33, pass=false).\n\n" +
      "(a) 왜 judge가 필요한가: HTML 텍스트가 다양해 결정론 비교 불가, 레이아웃·요소 재현은 judge가 시각 비교한다.\n" +
      "(b) 서버 prefilter (모두 case-insensitive 통과해야 judge로 진행):\n" +
      "  ① ```html``` 펜스 또는 일반 ``` 코드 펜스 존재\n" +
      "  ② 시맨틱 태그(<header>·<nav>·<main>·<section>·<footer>) 중 3개 이상\n" +
      "  ③ 필수 단서 `Get Started`, `Learn More`, `Feature title` 모두 포함\n" +
      JUDGE_OPS_KO +
      "(d) Judge 활성 시 rubric:\n" +
      "  • 3 = grid/flex 사용, 모든 라벨 섹션이 올바른 수직 순서, 라벨된 요소(버튼·내비·폼 필드) 모두 재현.\n" +
      "  • 2 = 레이아웃 대체로 맞으나 정렬 어긋남 또는 1~2개 사소한 누락.\n" +
      "  • 1 = 단일 컬럼으로 무너짐 OR 핵심 버튼·내비 누락.\n" +
      "  • 0 = 코드 생성 거부 / 무관한 코드.\n" +
      "(e) Judge 실패(timeout 30s / parse error / 5xx / API 키 없음): rubric 0 + reason에 `judge_timeout` / `judge_parse_error` / `judge_network_error` 라벨. 비전 미지원 모델 400은 `upstream_no_vision`으로 별도 라벨. pass는 score ≥ 0.67 (rubric ≥ 2).",
    promptNotesKo:
      "B 와이어프레임: Header(Logo+Nav 4개), Hero(Get Started + Hero Image/Video), Features Grid 3개, Testimonials 2개, Footer 3열. " +
      "vision_wireframe_html_a와 동일 역할 분리.",
    toolsSummaryKo: "없음.",
    routesKo: `${VISION_ROUTES_KO} 기본 max_tokens 4096(긴 HTML 출력).`,
    implementationKo:
      "scoreScenario: 펜스 추출 + substring 매칭(prefilter, case-insensitive) + 잠정 rubric 1(`judge_pending` 플래그). bench-runner가 judge enable + prefilter 통과 시 Claude Opus 4.7 호출 후 0~3 rubric으로 덮어쓴다. judge 실패는 rubric 0.",
  },
  translate_nist_fips197_pdf_tools: {
    purposeKo: "도구 호출로 NIST FIPS 197 PDF 텍스트를 읽고, 한국어 요약을 생성하는지 봅니다.",
    criteriaKo:
      "fetch_pdf_text 도구가 실제로 호출되고, 사고 블록을 제외한 최종 응답에 한글이 있으며 그 길이가 1000자 미만이면 합격입니다.",
    promptNotesKo:
      "system: PDF는 `fetch_pdf_text` 필수·한국어 1000자 상한·인용 금지. user: NIST FIPS 197 PDF URL + 한국어 요약 태스크만.",
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
