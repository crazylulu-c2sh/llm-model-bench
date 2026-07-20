/** GET /api/runs/:runId · GET .../latest-by-model 의 run 블록 */
export type BenchScenarioRun = {
  ttft_ms: number | null;
  total_ms: number;
  output_text: string;
  stream_completed: boolean;
  /** provider 보고 출력 토큰 수(없으면 null/미존재). 있으면 TPS가 이 값을 사용. */
  usage_output_tokens?: number | null;
  /** messages 라우트에서 추론이 숨겨진 채 측정됨 → TTFT 비교 주의. */
  reasoning_hidden?: boolean;
  /** #1922: 스트리밍 tool_call 인자 연결 손상 감지 → LM Studio 엔진 프로토콜 회귀 의심. */
  tool_call_args_corrupted?: boolean;
  /** chat 라우트에서 추론이 content로 새어 들어옴 → 엔진 프로토콜 회귀 의심. */
  reasoning_leaked_into_content?: boolean;
  /** #80: 분리된 reasoning 채널 raw 문자 수(thinking_leak_ratio 분자). */
  reasoning_chars?: number;
  /** #80: 가시 content 비었고 tool_call 없음 → 에이전트 정체(empty_turn). */
  empty_response?: boolean;
  /** #80: 가시 content에 <think>/<|channel|> 태그 잔존(라우트 무관) → 채널 태그 누수. */
  channel_tag_leak_detected?: boolean;
  /** #101: agent_loop — 사고가 per-turn max_tokens를 소진해 빈 content로 끝난 턴(no_signal 시그니처). */
  thinking_exhausted_budget?: boolean;
  /** #79: agent_loop — content=="" && tool_calls==0 인 빈 턴 수. */
  empty_turn_count?: number;
  /** #79: agent_loop — 완료까지 걸린 턴 수(미완료면 null). */
  turns_to_completion?: number | null;
  /** #79: agent_loop — 유효 tool_call을 낸 턴 비율(0~1). */
  valid_tool_call_rate?: number;
  /** #79: agent_loop — 중간(비최종) 턴 content에 사고/채널 태그 누수. */
  intermediate_turn_leak?: boolean;
  /** #105: agent_loop — argDispatch 인자 충실도 원자료(도구 없으면 부재). */
  tool_arg_hits?: number;
  tool_arg_attempts?: number;
  /** #105: agent_loop — 최종(무도구) 턴 출력 토큰(효율 분자). */
  final_turn_output_tokens?: number;
  /** #108 후속: agent_loop — 도구별 실제 호출 횟수. */
  tool_call_counts?: Record<string, number>;
  /** #79: agent_loop — 루프 종료 사유. */
  agent_completion_reason?: "completed" | "stall" | "budget_exhausted";
  quality?: { pass: boolean; score?: number; reason?: string };
};

/** #105: GET /api/scoreboard 의 모델 × 라우트 에이전트 능력 지표. */
export type AgentMetricsRow = {
  model_id: string;
  api_route: "chat_completions" | "messages";
  n: number;
  task_completion_rate: number;
  stall_rate: number;
  budget_exhausted_rate: number;
  thinking_budget_rate: number;
  task_ms_median: number | null;
  turns_median: number | null;
  valid_tool_call_rate_mean: number | null;
  tool_arg_fidelity: number | null;
  arg_attempt_rate: number | null;
  output_efficiency: number | null;
  quality_mean: number | null;
  workflow_adherence_mean: number | null;
};

/** #80: GET /api/scoreboard·/api/stats/model-latest 의 모델 × 라우트 누수/정체 지표. */
export type LeakMetricsRow = {
  model_id: string;
  api_route: "chat_completions" | "messages";
  thinking_leak_ratio: number | null;
  empty_turn_rate: number;
  channel_tag_leak: number;
  n: number;
};

export type BenchScenarioDetail = {
  id: string;
  api_route: "chat_completions" | "messages";
  runs: BenchScenarioRun[];
  prompt_system_preview: string | null;
  prompt_preview: string | null;
};

export type BenchRunDetailResponse = {
  meta: {
    run_id: string;
    base_url: string;
    provider: string;
    model_id: string;
    created_at: string;
    [k: string]: unknown;
  };
  scenarios: BenchScenarioDetail[];
};

export type LatestByModelResponse = {
  base_url: string;
  items: Array<{ model_id: string; run: BenchRunDetailResponse | null }>;
  sqlite_available?: boolean;
  sqlite_error?: string | null;
};

export type RunsListResponse = {
  runs: RunSummary[];
  sqlite_available?: boolean;
  sqlite_error?: string | null;
};

export type RunSummary = {
  run_id: string;
  created_at: string;
  finished_at: string | null;
  base_url: string;
  provider: string;
  model_id: string;
  status: string;
};

export type StatsModelLatestItem = {
  run_id: string;
  model_id: string;
  base_url: string;
  provider: string;
  finished_at: string;
  created_at: string;
  status: string;
  /** 측정 런이 있는 시나리오 개수 — 0이면 선택 불가 */
  scenario_count: number;
  /** #80: 모델 × 라우트 누수/정체 지표(구버전 응답엔 없음). */
  leaks?: LeakMetricsRow[];
};

export type StatsModelLatestResponse = {
  items: StatsModelLatestItem[];
  sqlite_available?: boolean;
  sqlite_error?: string | null;
};
