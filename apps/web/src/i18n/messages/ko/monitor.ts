// monitor 네임스페이스 — 프로바이더 모니터 페이지·메모리 위젯·에이전트/누수 표·비전 이미지 모달. ko가 진실의 원천.
export const monitor = {
  // 상단 컨트롤(ProviderMonitorPage)
  refresh: "새로고침",
  polling: "폴링",
  interval: "주기",
  intervalOption: (sec: number) => `${sec}초`,
  apiKeyLabel: "API Key (선택, 세션 한정)",
  apiKeyPlaceholder: "필요한 경우 입력",

  // 공통 상태 문구
  noData: "데이터 없음",
  loadedModels: (n: number) => `로드된 모델 (${n})`,
  noLoadedModels: "로드된 모델 없음",
  systemResources: "시스템 자원",
  memory: "메모리",
  inactiveReason: (reason: string) => `비활성 — ${reason}`,

  // loopback / localhost 비활성 안내
  notLoopbackLead: "이 환경에서는 클라이언트 IP가 loopback이 아니므로 ",
  notLoopbackStrong: "system/gpu/CLI 카드가 비활성",
  notLoopbackTail:
    "입니다 — provider HTTP 정보만 표시됩니다. (Docker Compose의 nginx 경유, 원격 브라우저 등) — README 의 “Provider 모니터링 · lms CLI” 단락을 참고하세요.",
  notLocalhostLead: "baseUrl 이 localhost 가 아니므로 system/gpu 정보는 비활성입니다. baseUrl 을",
  notLocalhostTail: " 등으로 두고 사용해 주세요.",

  // 로드된 모델 표
  providerHttpFailed: (status: string | number, detail: string) =>
    `provider HTTP 호출 실패 — ${status} ${detail}`,

  // 모델 로드/언로드 카드 (LM Studio CLI)
  loadUnloadTitle: "모델 로드/언로드 (LM Studio CLI)",
  modelIdLabel: "모델 ID (예: publisher/model)",
  modelIdPlaceholder: "LM Studio가 인식하는 모델 식별자",
  processing: "처리 중…",
  actionFailed: (action: string, detail: string) => `${action} 실패: ${detail}`,
  actionError: (action: string, detail: string) => `${action} 오류: ${detail}`,

  // lms server 로그 스트림 카드
  logStreamTitle: "lms server 로그 스트림",
  start: "시작",
  stop: "중지",
  clear: "지우기",
  noLines: "라인 없음",
  logStreamConnError: "연결 종료 또는 오류 (다른 클라이언트가 사용 중이거나 lms 프로세스 종료)",
  logStreamHint: (cap: number) =>
    `최대 ${cap}라인. 서버는 1:1 lock — 다른 클라이언트가 이미 받고 있으면 409.`,

  // 메모리 위젯(ProviderMemoryWidget)
  memoryMonitor: "메모리 모니터",
  systemRam: "시스템 RAM",
  widgetNotLoopback: "loopback이 아닌 환경 — 비활성",
  widgetNotLocalhost: "baseUrl이 localhost가 아님 — 비활성",

  // 점수 밴드 라벨(에이전트/누수 표 공용)
  bandLabel: { high: "우수", good: "양호", mid: "보통", low: "낮음" },

  // 표 공용 헤더
  colModel: "모델",
  colRoute: "라우트",

  // 에이전트 능력 지표 표(AgentMetricsTable)
  agentEmptyState:
    "에이전트 시나리오 측정 런이 없습니다 — 시나리오 선택에서 \"에이전트만\"을 켜고 벤치를 실행하세요.",
  agentTableCaption: "모델 × 라우트별 에이전트 능력 지표",
  nColTitleAgent: "이 (모델, 라우트) 슬라이스의 agent 런 수",
  agentMetricLabel: {
    task_completion_rate: "완료율",
    stall_rate: "정체율",
    budget_exhausted_rate: "예산소진율",
    thinking_budget_rate: "사고예산소진",
    task_ms_median: "과업ms",
    turns_median: "턴",
    valid_tool_call_rate_mean: "유효호출률",
    tool_arg_fidelity: "인자충실도",
    arg_attempt_rate: "인자시도율",
    output_efficiency: "출력효율",
    quality_mean: "품질(rubric)",
    workflow_adherence_mean: "워크플로",
    tool_call_excess_mean: "도구초과",
  },
  agentMetricTitle: {
    task_completion_rate: "completed / 전체 agent 런 — 높을수록 좋음",
    stall_rate: "stall / 전체 — 빈 턴 정체 비율(낮을수록 좋음)",
    budget_exhausted_rate: "budget_exhausted / 전체 — maxTurns 소진 비율(낮을수록 좋음)",
    thinking_budget_rate:
      "thinking_exhausted_budget=true 비율 — 사고로 per-turn 예산을 소진(낮을수록 좋음)",
    task_ms_median: "완료 런의 total_ms 중앙값 — 완료 과업당 벽시계(낮을수록 좋음)",
    turns_median: "완료 런의 turns_to_completion 중앙값",
    valid_tool_call_rate_mean:
      "유효 tool_call 턴 비율 평균. 분모에 최종 무도구 턴 포함 → k턴이면 k/(k+1)(높을수록 좋음)",
    tool_arg_fidelity:
      "Σtool_arg_hits / Σattempts — 불투명 id를 정확히 복사한 비율(높을수록 좋음). argDispatch 시나리오만",
    arg_attempt_rate:
      "attempts>0 런 비율 — 낮으면 복잡한 id를 보고 호출 자체를 포기(충실도와 함께 읽을 것)",
    output_efficiency:
      "Σ최종턴 토큰 / Σ전 턴 usage 토큰 — 중간 턴 사고 낭비의 역수(높을수록 좋음)",
    quality_mean:
      "결정론 rubric 평균 — **0~1 스케일**(다른 비율 지표와 의미가 다름). 스코어보드 메인 품질은 라우트를 풀링하므로 여기서 라우트별 발산을 본다",
    workflow_adherence_mean:
      "시나리오가 지시한 도구 중 실제로 부른 비율 — **점수에 반영되지 않는다**(적게 쓰고 정답이면 효율). 순위 해석용 진단 지표",
    tool_call_excess_mean:
      "도구 초과 호출 비율 max(0, 실제/기대−1) — 0=낭비 없음, >0=남용(예: 같은 도구를 반복 호출하다 예산 소진). 적게 부른 것은 0 이고 '워크플로' 컬럼이 따로 잰다. error_v1 의 기대치는 재시도를 포함하므로 이 지표는 재시도 실패를 잡지 않는다(품질 rubric 의 몫)",
  },

  // 누수/정체 지표 표(LeakTable)
  leakMetricLabel: {
    thinking_leak: "사고 누수",
    empty_turn: "빈 턴",
    channel_tag: "채널 태그",
  },
  leakMetricTitle: {
    thinking_leak: "thinking_leak_ratio = reasoning 토큰 / 총 출력 토큰 — 낮을수록 사고가 최종 답에 안 샘",
    empty_turn: "empty_turn_rate = content 비었고 tool_call 없는 런 비율 — 에이전트 정체 신호",
    channel_tag: "channel_tag_leak = <think>/<|channel|> 태그가 content에 남은 런 비율",
  },
  leakEmptyState: "누수/정체 지표를 계산할 측정 런이 없습니다.",
  leakTableCaption: "모델 × 라우트별 누수/정체 지표",
  safeCol: "안전",
  safeColTitle: "세 지표가 모두 임계 이하이면 agent-safe",
  nColTitleLeak: "이 (모델, 라우트) 슬라이스의 측정 런 수",
  leakWarningTitle: "누수/정체 임계 초과 — 에이전트 루프 주의",
  warningAria: "주의",

  // 비전 이미지 모달(VisionImageModal)
  close: "닫기",
  imageModalCloseAria: "이미지 모달 닫기",
  imageModalFooter: (url: string) => `${url} · Esc / 배경 클릭으로 닫기`,
};
