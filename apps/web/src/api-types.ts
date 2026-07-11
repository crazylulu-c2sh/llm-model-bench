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
  quality?: { pass: boolean; score?: number; reason?: string };
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
