import type { BenchResult, LeakMetricsRow, ScenarioCategory } from "@llm-bench/shared";

export type BenchScenarioRun = BenchResult["scenarios"][number]["runs"][number];

export type BenchScenarioDetail = {
  source_run_id?: string;
  id: string;
  api_route: "chat_completions" | "messages";
  runs: BenchScenarioRun[];
  prompt_system_preview: string | null;
  prompt_preview: string | null;
};

export type BenchRunDetailResponse = {
  meta: {
    config_id?: string;
    config?: Record<string, unknown>;
    config_complete?: boolean;
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
  config_id?: string;
  config?: Record<string, unknown>;
  config_complete?: boolean;
  run_id: string;
  model_id: string;
  /** 모델 게시자(조직) — meta_json에 없으면(기존 런) model_id 접두 파생. */
  publisher?: string;
  base_url: string;
  provider: string;
  finished_at: string;
  created_at: string;
  status: string;
  /** 측정 런이 있는 시나리오 개수 — 0이면 선택 불가 */
  scenario_count: number;
  /** 측정 시나리오가 속한 카테고리(text/vision/agent) — 고유·정렬됨. 카드 카테고리 필터용(구버전 응답엔 없음). */
  categories?: ScenarioCategory[];
  /** #80: 모델 × 라우트 누수/정체 지표(구버전 응답엔 없음). */
  leaks?: LeakMetricsRow[];
};

export type StatsModelLatestResponse = {
  items: StatsModelLatestItem[];
  sqlite_available?: boolean;
  sqlite_error?: string | null;
};
