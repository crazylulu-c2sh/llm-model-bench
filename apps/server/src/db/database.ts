import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { BenchRunMeta } from "@llm-bench/shared";

export type RunStatus = "running" | "ok" | "partial" | "error";

export function defaultDbPath(): string {
  return process.env.BENCH_DB_PATH ?? path.resolve(process.cwd(), "data", "bench.sqlite");
}

export function openBenchDatabase(filePath: string): Database.Database {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

let prodDbCache: Database.Database | null | undefined;
let prodDbOpenError: string | null = null;

/**
 * 기본 경로(`BENCH_DB_PATH` / `data/bench.sqlite`)로 DB를 한 번만 연다.
 * `better-sqlite3` 네이티브 모듈 오류(노드 ABI 불일치 등) 시 null을 반환하고 벤치는 계속할 수 있게 한다.
 */
export function tryOpenProdBenchDatabase(): Database.Database | null {
  if (prodDbCache !== undefined) return prodDbCache;
  try {
    prodDbCache = openBenchDatabase(defaultDbPath());
    prodDbOpenError = null;
    return prodDbCache;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    prodDbOpenError = msg;
    prodDbCache = null;
    console.error(
      "[llm-bench-server] SQLite를 열 수 없습니다. 히스토리 API·런 저장이 비활성화됩니다. (원인: Node 버전 변경 후 `pnpm rebuild better-sqlite3` 시도)",
      msg,
    );
    return null;
  }
}

export function getProdBenchDatabaseOpenError(): string | null {
  return prodDbOpenError;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      version INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bench_runs (
      run_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      base_url TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      status TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bench_runs_base_model_time
      ON bench_runs (base_url, model_id, finished_at DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bench_runs_created
      ON bench_runs (created_at DESC);
    CREATE TABLE IF NOT EXISTS bench_scenarios (
      run_id TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      api_route TEXT NOT NULL,
      aggregate_json TEXT NOT NULL,
      prompt_preview TEXT,
      PRIMARY KEY (run_id, scenario_id, api_route),
      FOREIGN KEY (run_id) REFERENCES bench_runs(run_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS bench_text_logs (
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      ts TEXT NOT NULL,
      line TEXT NOT NULL,
      PRIMARY KEY (run_id, seq),
      FOREIGN KEY (run_id) REFERENCES bench_runs(run_id) ON DELETE CASCADE
    );
  `);
  const row = db.prepare(`SELECT version FROM schema_migrations ORDER BY id DESC LIMIT 1`).get() as
    | { version: number }
    | undefined;
  if (!row) db.prepare(`INSERT INTO schema_migrations (version) VALUES (1)`).run();
}

export function insertRun(
  db: Database.Database,
  row: {
    run_id: string;
    created_at: string;
    base_url: string;
    provider: string;
    model_id: string;
    meta: BenchRunMeta;
    status: RunStatus;
  },
): void {
  db.prepare(
    `INSERT INTO bench_runs (run_id, created_at, base_url, provider, model_id, meta_json, status)
     VALUES (@run_id, @created_at, @base_url, @provider, @model_id, @meta_json, @status)`,
  ).run({
    ...row,
    meta_json: JSON.stringify(row.meta),
  });
}

export function upsertScenarioAggregate(
  db: Database.Database,
  row: {
    run_id: string;
    scenario_id: string;
    api_route: string;
    aggregate_json: string;
    prompt_preview: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO bench_scenarios (run_id, scenario_id, api_route, aggregate_json, prompt_preview)
     VALUES (@run_id, @scenario_id, @api_route, @aggregate_json, @prompt_preview)
     ON CONFLICT(run_id, scenario_id, api_route) DO UPDATE SET
       aggregate_json = excluded.aggregate_json,
       prompt_preview = COALESCE(excluded.prompt_preview, bench_scenarios.prompt_preview)`,
  ).run(row);
}

export function appendTextLog(db: Database.Database, run_id: string, seq: number, line: string): void {
  db.prepare(
    `INSERT INTO bench_text_logs (run_id, seq, ts, line) VALUES (@run_id, @seq, @ts, @line)`,
  ).run({
    run_id,
    seq,
    ts: new Date().toISOString(),
    line: line.slice(0, 4000),
  });
}

export function finishRun(
  db: Database.Database,
  run_id: string,
  status: RunStatus,
  err?: { code?: string; message?: string },
): void {
  db.prepare(
    `UPDATE bench_runs SET
      finished_at = @finished_at,
      status = @status,
      error_code = @error_code,
      error_message = @error_message
     WHERE run_id = @run_id`,
  ).run({
    run_id,
    finished_at: new Date().toISOString(),
    status,
    error_code: err?.code ?? null,
    error_message: err?.message?.slice(0, 2000) ?? null,
  });
}

export function markRunErrorPartial(
  db: Database.Database,
  run_id: string,
  code: string,
  message: string,
): void {
  db.prepare(
    `UPDATE bench_runs SET
      status = CASE WHEN status = 'running' THEN 'partial' ELSE status END,
      error_code = @code,
      error_message = @message
     WHERE run_id = @run_id`,
  ).run({ run_id, code: code.slice(0, 200), message: message.slice(0, 2000) });
}

export type RunSummaryRow = {
  run_id: string;
  created_at: string;
  finished_at: string | null;
  base_url: string;
  provider: string;
  model_id: string;
  status: string;
};

export function listRecentRuns(db: Database.Database, limit: number): RunSummaryRow[] {
  return db
    .prepare(
      `SELECT run_id, created_at, finished_at, base_url, provider, model_id, status
       FROM bench_runs ORDER BY datetime(created_at) DESC LIMIT ?`,
    )
    .all(Math.min(Math.max(limit, 1), 200)) as RunSummaryRow[];
}

export function getRunMetaJson(db: Database.Database, run_id: string): string | null {
  const r = db.prepare(`SELECT meta_json FROM bench_runs WHERE run_id = ?`).get(run_id) as
    | { meta_json: string }
    | undefined;
  return r?.meta_json ?? null;
}

export type ScenarioRow = {
  scenario_id: string;
  api_route: string;
  aggregate_json: string;
  prompt_preview: string | null;
};

export function listScenariosForRun(db: Database.Database, run_id: string): ScenarioRow[] {
  return db
    .prepare(
      `SELECT scenario_id, api_route, aggregate_json, prompt_preview
       FROM bench_scenarios WHERE run_id = ? ORDER BY scenario_id, api_route`,
    )
    .all(run_id) as ScenarioRow[];
}

export type LatestRunRow = RunSummaryRow & { meta_json: string };

/** 각 model_id당 base_url 일치 런 중 finished_at/created_at 최신 1건 */
export function latestFinishedRunsByModels(
  db: Database.Database,
  baseUrl: string,
  modelIds: string[],
): Map<string, LatestRunRow> {
  const norm = baseUrl.replace(/\/+$/, "");
  const out = new Map<string, LatestRunRow>();
  const sel = db.prepare(
    `SELECT r.run_id, r.created_at, r.finished_at, r.base_url, r.provider, r.model_id, r.status, r.meta_json
     FROM bench_runs r
     WHERE r.base_url = ? AND r.model_id = ? AND r.status IN ('ok', 'partial') AND r.finished_at IS NOT NULL
     ORDER BY datetime(r.finished_at) DESC, datetime(r.created_at) DESC, r.rowid DESC
     LIMIT 1`,
  );
  for (const mid of modelIds) {
    const row = sel.get(norm, mid) as LatestRunRow | undefined;
    if (row) out.set(mid, row);
  }
  return out;
}

/** (model_id, base_url) 조합마다 finished 런 중 최신 1건 — 통계 목록용 */
export type LatestFinishedRunSummary = {
  run_id: string;
  created_at: string;
  finished_at: string;
  base_url: string;
  provider: string;
  model_id: string;
  status: string;
  /** 집계 JSON에 측정 런이 1개 이상 있는 시나리오 행 수 — 0이면 차트·표에 쓸 데이터 없음 */
  scenario_count: number;
};

export function listLatestFinishedRunSummaries(db: Database.Database): LatestFinishedRunSummary[] {
  return db
    .prepare(
      `SELECT ranked.run_id, ranked.created_at, ranked.finished_at, ranked.base_url, ranked.provider, ranked.model_id, ranked.status,
         (
           SELECT COUNT(*)
           FROM bench_scenarios s
           WHERE s.run_id = ranked.run_id
             AND COALESCE(json_array_length(json_extract(s.aggregate_json, '$.runs')), 0) > 0
         ) AS scenario_count
       FROM (
         SELECT run_id, created_at, finished_at, base_url, provider, model_id, status,
           ROW_NUMBER() OVER (
             PARTITION BY model_id, base_url
             ORDER BY datetime(finished_at) DESC, datetime(created_at) DESC, rowid DESC
           ) AS rn
         FROM bench_runs
         WHERE status IN ('ok', 'partial') AND finished_at IS NOT NULL
       ) AS ranked
       WHERE rn = 1
       ORDER BY model_id, base_url`,
    )
    .all() as LatestFinishedRunSummary[];
}
