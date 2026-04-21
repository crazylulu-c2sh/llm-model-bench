/** GET /api/runs/:runId · GET .../latest-by-model 의 run 블록 */
export type BenchScenarioRun = {
  ttft_ms: number | null;
  tpot_ms: number | null;
  total_ms: number;
  output_text: string;
  stream_completed: boolean;
  quality?: { pass: boolean; score?: number; reason?: string };
};

export type BenchScenarioDetail = {
  id: string;
  api_route: "chat_completions" | "messages";
  runs: BenchScenarioRun[];
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
};

export type StatsModelLatestResponse = {
  items: StatsModelLatestItem[];
  sqlite_available?: boolean;
  sqlite_error?: string | null;
};
