// stress 네임스페이스 — 프로바이더 벤치(스트레스) 페이지·컴포넌트. ko가 진실의 원천.
import type { StressWorkloadId } from "@llm-bench/shared";

export const stress = {
  // 워크로드 표시 라벨 — 화면용(모델 입력 프롬프트 아님). `stress-labels.ts`에서 참조.
  workload: {
    stress_ping: "짧은 ping (영어)",
    stress_short_reply: "짧은 문장 응답 (영어)",
    stress_short_reply_ko: "짧은 문장 응답 (한국어)",
    stress_short_reply_ja: "짧은 문장 응답 (일본어)",
    stress_long_context: "긴 컨텍스트 / Prefill 부하 (영어)",
    stress_long_context_ko: "긴 컨텍스트 / Prefill 부하 (한국어)",
    stress_long_context_ja: "긴 컨텍스트 / Prefill 부하 (일본어)",
  } satisfies Record<StressWorkloadId, string>,

  // 상단 소개 섹션 (emphasis 부분은 <strong>로 감쌈)
  intro: {
    heading: "프로바이더 벤치 — v1",
    before:
      "같은 모델을 여러 사용자가 동시에 사용할 때 처리량(TPS)이 어떻게 변하는지 측정합니다. 1순위 지표는 ",
    emphasis: "동시 사용자 수 대비 집계 TPS",
    after: "입니다. 메모리·CPU 사용량 등 OS 지표는 v1에서 제공하지 않습니다.",
  },

  // 1) 프로바이더 감지 섹션
  detect: {
    heading: "1) 프로바이더 감지",
    apiKeyLabel: "API key (선택)",
    detectBtn: "감지",
    persistLabel: "이 브라우저에 API 키 저장 (로컬 디스크, 평문)",
    persistWarnBefore: "끄면 같은 탭에서만 ",
    persistWarnMid:
      "에 보관되어 새로고침은 유지되나 브라우저를 닫으면 사라질 수 있습니다. 켜면 ",
    persistWarnAfter: " 평문으로 남으며 XSS 등에 노출될 수 있습니다.",
    models: (n: number) => `모델 ${n}개`,
    routes: (list: string) => `라우트 ${list}`,
    routesNone: "없음",
  },

  // 2) 모델 선택 섹션
  model: {
    heading: "2) 모델 선택 (단일)",
    selectedLabel: "선택됨:",
    hint: "v1은 *한 모델*만 측정합니다. 행을 한 번 더 클릭해 해제 가능.",
  },

  // 3) 워크로드 & ramp 섹션
  ramp: {
    heading: "3) 워크로드 & ramp",
    workload: "워크로드",
    startCC: "시작 동시성",
    maxCC: "최대 동시성",
    step: "스텝",
    stageDuration: "단계 duration (ms)",
    requestTimeout: "요청 timeout (ms)",
    perWorkerSuffix: "워커별 client 접미사",
    expectedStages: "예상 단계 수:",
    expectedLanguage: "예상 응답 언어:",
    longContextTips:
      "긴 컨텍스트 권장: temperature 0 · timeout ≥ 120s · max_tokens 비우기(32) · 워커별 client 접미사 끄기(prefix caching 엔진)",
  },

  // 4) 프롬프트 미리보기 섹션
  preview: {
    heading: "4) 프롬프트 미리보기 (실제 요청과 동일)",
  },

  // 실행/중지 컨트롤
  run: {
    runBtn: "실행",
    stopBtn: "중지",
    running: (tps: string) => `실행 중 · 라이브 TPS ${tps}`,
    runningIdle: "실행 중…",
  },

  // 하단 메모리 지표 안내 (label 부분은 <strong>)
  memNote: {
    label: "메모리 지표",
    body:
      ": v1에서는 N/A — LM Studio REST API에 런타임 메모리 엔드포인트가 없어 스코프 아웃했습니다.",
  },

  // 동시 사용자 모니터 그리드
  grid: {
    region: "동시 사용자 모니터",
    regionFinished: "동시 사용자 모니터 (종료 스냅샷)",
    regionError: "동시 사용자 모니터 (오류 스냅샷)",
    preparing: (slots: number) => `${slots}명 사전 확보 · 준비 중…`,
    runningStage: (stage: number, concurrency: number, slots: number) =>
      `단계 ${stage} · 동시 ${concurrency}/${slots}명 활성`,
    lastStage: (stage: number, concurrency: number) =>
      `마지막 단계 ${stage} · 동시 ${concurrency}명`,
    tagFinished: "종료",
    tagAborted: "중단",
    tagError: "오류",
    liveWorkers: "동시 워커 라이브",
    truncated: (concurrency: number, shown: number, hidden: number) =>
      `동시 사용자 ${concurrency}명 중 ${shown}명만 라이브로 보여집니다 — 나머지 ${hidden}명은 집계 차트·표에 그대로 반영`,
  },

  // 동시 사용자 vs 집계 TPS 차트
  chart: {
    heading: "동시 사용자 vs 집계 TPS",
    headingNote: "사용자당 TPS 막대 색 = 체감 등급",
    ariaLabel: "동시 사용자 단계별 집계 TPS 차트 — 자세한 값은 단계별 결과 표 참조",
    xLabel: "동시 사용자 수",
    legendAggregate: "집계 TPS",
    legendPerUser: "사용자당 TPS",
    legendPerUserColored: "사용자당 TPS (색 = 체감 등급)",
    perUserPrefix: "사용자당 TPS:",
    footNoteBefore: "· 표 집계 TPS의 ",
    footNoteAfter:
      "(신뢰도 낮음) 단계는 막대 생략 + 회색 · approx는 chars/4 추정이라 CJK에서 한 단계 낮게 보일 수 있음",
    explain:
      "ramp 단계 종료마다 갱신됩니다. 동시성이 증가하다 TPS가 평탄해지면 처리량 한계, 하락하면 큐잉/리소스 경합 신호입니다.",
  },

  // 워커 셀
  worker: {
    streaming: "스트리밍",
    done: "완료",
    error: "오류",
    requesting: "요청 중",
    idle: "대기",
    userNumber: (n: number) => `사용자 #${n}`,
    response: "응답",
    thinking: "🧠 사고 중",
    reqCount: (n: number) => `req ${n}건`,
    last: (v: string) => `마지막 ${v}`,
  },

  // 단계 진행 프로그레스 바
  progress: {
    label: "단계 진행",
    valueText: (pct: number) => `단계 진행 ${pct}%`,
    valueTextDraining: (pct: number) => `단계 진행 ${pct}% · drain 중`,
    draining: "drain 중…",
  },

  // TPS 체감 등급(tps-tier). 표·차트 공통.
  tpsTier: {
    fast: "쾌적",
    good: "쓸만",
    okay: "채택가능",
    slow: "너무 느림",
  },
  tpsUnreliableTooltip: "— (신뢰도 낮음)",

  // 단계별 결과 표
  table: {
    heading: "단계별 결과",
    caption: "동시성 단계별 스트레스 벤치 결과",
    concurrency: "동시성",
    tpsPerUser: "TPS/사용자",
    successRate: "성공률",
    totalP50: "총 p50",
    totalP95: "총 p95",
    ttftTitle: "Time To First Token (prefill·KV 캐시 지표)",
    errorRate: "에러율",
    expectedResponseRate: (script: string) => `예상 응답률(${script})`,
    lowConfidence: "신뢰도 낮음",
    empty: "아직 결과가 없습니다.",
    perUserHeaderTitle: (fast: number, good: number, okay: number) =>
      `색: 쾌적 ≥${fast} · 쓸만 ${good}–${fast - 1} · 채택가능 ${okay}–${good - 1} · 너무 느림 <${okay}`,
    allApproxNote:
      "이 런은 provider가 usage 토큰 수를 보고하지 않아 모든 단계에서 chars/4 추정치(approx)로 TPS를 계산했습니다. CJK 응답은 토큰당 글자 수가 적어 과소 추정 오차가 큽니다.",
    mixedNoteBefore: "일부 단계가 ",
    mixedNoteMid1: "(또는 ",
    mixedNoteMid2: ")로 떨어졌습니다 — provider가 해당 요청에서 usage를 보내지 않았거나 ",
    mixedNoteAfter:
      "를 거부한 경우입니다. approx 단계의 TPS는 chars/4 추정치이며 CJK 응답에서 오차가 큽니다.",
    unreliableNoteBefore: "집계 TPS의 ",
    unreliableNoteMid:
      "(신뢰도 낮음 — 표본 부족·단계 너무 짧음·성공 없음) 단계는 TPS/사용자 셀이 회색(",
    unreliableNoteAfter: ")으로 표시됩니다.",
  },

  // 프로바이더 통계 페이지 (StressStatsPage)
  stats: {
    filterHeading: "필터",
    all: "전체",
    apply: "적용",
    applying: "적용 중…",
    reset: "초기화",
    runsHeading: (count: number, hasMore: boolean) =>
      `프로바이더 런 (${count}건${hasMore ? "+" : ""})`,
    loading: "불러오는 중…",
    empty: "표시할 런이 없습니다. /stress에서 먼저 실행하세요.",
    loadMore: "더 보기",
    loadingMore: "더 불러오는 중…",
    deleteRunAria: "런 삭제",
    detailHeading: "상세",
    selectRun: "위 리스트에서 런을 선택하세요.",
    runningBefore: "이 런은 진행 중입니다 — ",
    runningLink: "라이브 모니터링 보기",
    runningAfter: ". 현재까지 완료된 단계만 표시됩니다.",
    confirmTitle: "프로바이더 런 삭제",
    confirmDelete: "삭제",
    confirmBody: "이 런과 모든 단계 결과가 영구 삭제됩니다 (되돌릴 수 없음).",
    confirmLiveWarn:
      "⚠ 라이브 실행 중인 런입니다 — /stress에서 동시에 실행 중이면 데이터 손상 위험.",
    field: {
      model: "모델",
      provider: "프로바이더",
      workload: "워크로드",
      status: "상태",
      started: "시작",
      finished: "종료",
    },
  },

  // 토스트·에러 라인 (imperative — msg()로 발화 시점 로케일 읽기)
  toast: {
    selectModel: "프로바이더를 감지하고 모델 1개를 선택하세요.",
    benchError: (code: string) => `프로바이더 벤치 오류: ${code}`,
    aborted: "중단됨 — 부분 결과가 유지됩니다.",
    detectFailed: (status: number, detail: string) => `감지 실패: ${status} ${detail}`,
    detectException: (err: string) => `감지 예외: ${err}`,
    serverError: (status: number, detail: string) => `서버 오류: ${status} ${detail}`,
    streamException: (err: string) => `스트림 예외: ${err}`,
    sqliteUnavailable: "SQLite를 사용할 수 없습니다.",
    runGone: "런이 더 이상 존재하지 않습니다.",
    detailLoadFailed: (status: number) => `상세 로드 실패 (${status})`,
    deleteFailed: (status: number) => `삭제 실패 (${status})`,
    deleted: "삭제됨",
  },
};
