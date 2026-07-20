import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BenchRunMeta, StressRunStatus } from "@llm-bench/shared";

export type { StressRunStatus };

export type RunStatus = "running" | "ok" | "partial" | "error";

export function defaultDbPath(): string {
  return process.env.BENCH_DB_PATH ?? path.resolve(process.cwd(), "data", "bench.sqlite");
}

export function openBenchDatabase(filePath: string): DatabaseSync {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

let prodDbCache: DatabaseSync | null | undefined;
let prodDbOpenError: string | null = null;
let prodDbLastFailureAt = 0;
/** 열기 실패 후 다음 재시도까지 최소 간격(ms). 일시적 잠금·권한 문제는 자동 복구되도록 함. */
const PROD_DB_RETRY_AFTER_MS = 60_000;

/**
 * 기본 경로(`BENCH_DB_PATH` / `data/bench.sqlite`)로 DB를 연다.
 * - 한 번 성공하면 프로세스 생애 동안 같은 인스턴스를 재사용.
 * - 열기 실패 시 null을 반환하고 벤치는 계속할 수 있게 함. 최근 실패(< {@link PROD_DB_RETRY_AFTER_MS}ms)면
 *   파일 I/O를 아끼기 위해 즉시 null 반환, 그 이후 호출에서 자동 재시도.
 */
export function tryOpenProdBenchDatabase(): DatabaseSync | null {
  if (prodDbCache) return prodDbCache;
  if (prodDbCache === null && Date.now() - prodDbLastFailureAt < PROD_DB_RETRY_AFTER_MS) {
    return null;
  }
  try {
    prodDbCache = openBenchDatabase(defaultDbPath());
    prodDbOpenError = null;
    prodDbLastFailureAt = 0;
    return prodDbCache;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    prodDbOpenError = msg;
    prodDbCache = null;
    prodDbLastFailureAt = Date.now();
    console.error(
      "[llm-bench-server] SQLite를 열 수 없습니다. 히스토리 API·런 저장이 비활성화됩니다. (DB 경로·권한·잠금 상태를 확인하세요)",
      msg,
    );
    return null;
  }
}

/**
 * @internal 진단/테스트 전용. **클라이언트 응답에 노출하지 말 것** — 경로·errno 등이 새어나간다.
 * 현재 production 응답은 모두 generic 문구(`SQLITE_PUBLIC_UNAVAILABLE_MSG`)만 보낸다.
 */
export function getProdBenchDatabaseOpenError(): string | null {
  return prodDbOpenError;
}

/**
 * SIGTERM/SIGINT 등 정상 종료 시 호출 — WAL truncate 후 닫음. 미열림 상태면 no-op.
 * 캐시를 `undefined`로 리셋해 같은 프로세스에서 다음 `tryOpenProdBenchDatabase()`가 재시도 없이 즉시 열 수 있게 한다
 * (테스트 teardown / hot-reload 등에서 유용).
 */
export function closeProdBenchDatabase(): void {
  const db = prodDbCache;
  prodDbCache = undefined;
  prodDbOpenError = null;
  prodDbLastFailureAt = 0;
  if (!db) return;
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    // checkpoint 실패해도 close는 시도
  }
  try {
    db.close();
  } catch {
    // 이미 닫힌 경우 등 — 무시
  }
}

function migrate(db: DatabaseSync): void {
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
      prompt_system_preview TEXT,
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
    CREATE TABLE IF NOT EXISTS stress_runs (
      run_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      base_url TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      workload_id TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      status TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stress_runs_created
      ON stress_runs (created_at DESC);
    CREATE TABLE IF NOT EXISTS stress_stages (
      run_id TEXT NOT NULL,
      stage_index INTEGER NOT NULL,
      concurrency INTEGER NOT NULL,
      result_json TEXT NOT NULL,
      PRIMARY KEY (run_id, stage_index),
      FOREIGN KEY (run_id) REFERENCES stress_runs(run_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS custom_scenarios (
      id TEXT PRIMARY KEY,
      def_json TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'custom',
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
  `);
  const scenarioCols = db.prepare(`PRAGMA table_info(bench_scenarios)`).all() as Array<{ name: string }>;
  if (!scenarioCols.some((c) => c.name === "prompt_system_preview")) {
    db.exec(`ALTER TABLE bench_scenarios ADD COLUMN prompt_system_preview TEXT`);
  }
  const row = db.prepare(`SELECT version FROM schema_migrations ORDER BY id DESC LIMIT 1`).get() as
    | { version: number }
    | undefined;
  const currentVersion = row?.version ?? 0;
  if (currentVersion < 1) {
    db.prepare(`INSERT INTO schema_migrations (version) VALUES (1)`).run();
  }
  if (currentVersion < 2) {
    db.prepare(`INSERT INTO schema_migrations (version) VALUES (2)`).run();
  }
  if (currentVersion < 3) {
    // #83: custom_scenarios 테이블 도입.
    db.prepare(`INSERT INTO schema_migrations (version) VALUES (3)`).run();
  }
}

// ─── #83: 커스텀 시나리오 영속화 ──────────────────────────────────────────────
export type CustomScenarioRow = {
  id: string;
  def_json: string;
  source: string;
  created_at: string;
  updated_at: string | null;
};

/** 커스텀 시나리오 upsert(재등록 시 def·updated_at 갱신). */
export function upsertCustomScenario(
  db: DatabaseSync,
  row: { id: string; def_json: string; now: string },
): void {
  db.prepare(
    `INSERT INTO custom_scenarios (id, def_json, source, created_at, updated_at)
     VALUES (@id, @def_json, 'custom', @now, @now)
     ON CONFLICT(id) DO UPDATE SET def_json = excluded.def_json, updated_at = excluded.updated_at`,
  ).run({ id: row.id, def_json: row.def_json, now: row.now });
}

export function listCustomScenarios(db: DatabaseSync): CustomScenarioRow[] {
  return db
    .prepare(`SELECT id, def_json, source, created_at, updated_at FROM custom_scenarios ORDER BY id`)
    .all() as CustomScenarioRow[];
}

export function countCustomScenarios(db: DatabaseSync): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM custom_scenarios`).get() as { n: number };
  return Number(r?.n ?? 0);
}

export function deleteCustomScenario(db: DatabaseSync, id: string): number {
  return Number(db.prepare(`DELETE FROM custom_scenarios WHERE id = ?`).run(id).changes);
}

export function insertStressRun(
  db: DatabaseSync,
  row: {
    run_id: string;
    created_at: string;
    base_url: string;
    provider: string;
    model_id: string;
    workload_id: string;
    meta_json: string;
    status: StressRunStatus;
  },
): void {
  db.prepare(
    `INSERT INTO stress_runs (run_id, created_at, base_url, provider, model_id, workload_id, meta_json, status)
     VALUES (@run_id, @created_at, @base_url, @provider, @model_id, @workload_id, @meta_json, @status)`,
  ).run(row);
}

export function upsertStressStage(
  db: DatabaseSync,
  row: { run_id: string; stage_index: number; concurrency: number; result_json: string },
): void {
  db.prepare(
    `INSERT INTO stress_stages (run_id, stage_index, concurrency, result_json)
     VALUES (@run_id, @stage_index, @concurrency, @result_json)
     ON CONFLICT(run_id, stage_index) DO UPDATE SET
       concurrency = excluded.concurrency,
       result_json = excluded.result_json`,
  ).run(row);
}

export function finishStressRun(
  db: DatabaseSync,
  run_id: string,
  status: StressRunStatus,
  err?: { code?: string; message?: string },
): void {
  db.prepare(
    `UPDATE stress_runs SET
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

export function markStressRunErrorPartial(
  db: DatabaseSync,
  run_id: string,
  code: string,
  message: string,
): void {
  db.prepare(
    `UPDATE stress_runs SET
      status = CASE WHEN status = 'running' THEN 'partial' ELSE status END,
      error_code = @code,
      error_message = @message
     WHERE run_id = @run_id`,
  ).run({ run_id, code: code.slice(0, 200), message: message.slice(0, 2000) });
}

export type StressRunSummaryRow = {
  run_id: string;
  created_at: string;
  finished_at: string | null;
  base_url: string;
  provider: string;
  model_id: string;
  workload_id: string;
  status: string;
};

export type StressRunListOpts = {
  workload_id?: string;
  status?: string;
  model_id?: string;
  base_url?: string;
  before_created_at?: string;
  before_run_id?: string;
  limit: number;
};

export function listStressRunsFiltered(
  db: DatabaseSync,
  opts: StressRunListOpts,
): StressRunSummaryRow[] {
  const where: string[] = [];
  const params: Record<string, string | number> = {};
  if (opts.workload_id) {
    where.push("workload_id = @workload_id");
    params.workload_id = opts.workload_id;
  }
  if (opts.status) {
    where.push("status = @status");
    params.status = opts.status;
  }
  if (opts.model_id) {
    where.push("model_id = @model_id");
    params.model_id = opts.model_id;
  }
  if (opts.base_url) {
    where.push("RTRIM(base_url, '/') = RTRIM(@base_url, '/')");
    params.base_url = opts.base_url;
  }
  if (opts.before_created_at) {
    where.push(
      "(datetime(created_at) < datetime(@before_created_at) OR (datetime(created_at) = datetime(@before_created_at) AND run_id < @before_run_id))",
    );
    params.before_created_at = opts.before_created_at;
    params.before_run_id = opts.before_run_id ?? "";
  }
  params.limit = Math.min(Math.max(opts.limit, 1), 200);
  const sql = `SELECT run_id, created_at, finished_at, base_url, provider, model_id, workload_id, status
               FROM stress_runs
               ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY datetime(created_at) DESC, run_id DESC
               LIMIT @limit`;
  return db.prepare(sql).all(params) as StressRunSummaryRow[];
}

export type StressRunMetaRow = StressRunSummaryRow & {
  meta_json: string;
  error_code: string | null;
  error_message: string | null;
};

export function getStressRunMeta(
  db: DatabaseSync,
  run_id: string,
): StressRunMetaRow | null {
  const r = db
    .prepare(
      `SELECT run_id, created_at, finished_at, base_url, provider, model_id, workload_id, status,
              meta_json, error_code, error_message
       FROM stress_runs WHERE run_id = ?`,
    )
    .get(run_id);
  return (r ?? null) as StressRunMetaRow | null;
}

export type StressFilterOptionsRow = {
  workload_ids: string[];
  statuses: string[];
  model_ids: string[];
  base_urls: string[];
};

export function getStressFilterOptions(db: DatabaseSync): StressFilterOptionsRow {
  // `col`은 호출부에서 4개 하드코딩 리터럴만 넘김 — 외부 입력에 노출하면 SQL 인젝션 위험.
  const q = (col: string): string[] =>
    (
      db
        .prepare(`SELECT DISTINCT ${col} AS v FROM stress_runs ORDER BY v LIMIT 200`)
        .all() as Array<{ v: string }>
    ).map((r) => r.v);
  return {
    workload_ids: q("workload_id"),
    statuses: q("status"),
    model_ids: q("model_id"),
    base_urls: q("base_url"),
  };
}

export function deleteStressRun(db: DatabaseSync, run_id: string): number {
  return Number(db.prepare(`DELETE FROM stress_runs WHERE run_id = ?`).run(run_id).changes);
}

export type StressStageRow = {
  stage_index: number;
  concurrency: number;
  result_json: string;
};

export function listStressStages(db: DatabaseSync, run_id: string): StressStageRow[] {
  return db
    .prepare(
      `SELECT stage_index, concurrency, result_json
       FROM stress_stages WHERE run_id = ? ORDER BY stage_index ASC`,
    )
    .all(run_id) as StressStageRow[];
}

export function insertRun(
  db: DatabaseSync,
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
    run_id: row.run_id,
    created_at: row.created_at,
    base_url: row.base_url,
    provider: row.provider,
    model_id: row.model_id,
    status: row.status,
    meta_json: JSON.stringify(row.meta),
  });
}

export function upsertScenarioAggregate(
  db: DatabaseSync,
  row: {
    run_id: string;
    scenario_id: string;
    api_route: string;
    aggregate_json: string;
    prompt_preview: string | null;
    prompt_system_preview: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO bench_scenarios (run_id, scenario_id, api_route, aggregate_json, prompt_preview, prompt_system_preview)
     VALUES (@run_id, @scenario_id, @api_route, @aggregate_json, @prompt_preview, @prompt_system_preview)
     ON CONFLICT(run_id, scenario_id, api_route) DO UPDATE SET
       aggregate_json = excluded.aggregate_json,
       prompt_preview = COALESCE(excluded.prompt_preview, bench_scenarios.prompt_preview),
       prompt_system_preview = COALESCE(excluded.prompt_system_preview, bench_scenarios.prompt_system_preview)`,
  ).run(row);
}

export function appendTextLog(db: DatabaseSync, run_id: string, seq: number, line: string): void {
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
  db: DatabaseSync,
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
  db: DatabaseSync,
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

export function listRecentRuns(db: DatabaseSync, limit: number): RunSummaryRow[] {
  return db
    .prepare(
      `SELECT run_id, created_at, finished_at, base_url, provider, model_id, status
       FROM bench_runs ORDER BY datetime(created_at) DESC LIMIT ?`,
    )
    .all(Math.min(Math.max(limit, 1), 200)) as RunSummaryRow[];
}

export function getRunMetaJson(db: DatabaseSync, run_id: string): string | null {
  const r = db.prepare(`SELECT meta_json FROM bench_runs WHERE run_id = ?`).get(run_id) as
    | { meta_json: string }
    | undefined;
  return r?.meta_json ?? null;
}

/**
 * 기존 `meta_json`에 partial을 얕게 머지해 UPDATE한다. 오염 가드의 `contention_summary`처럼
 * INSERT 시점에 알 수 없고 런 종료 시 확정되는 값을 영속화하는 데 사용. 행이 없거나 meta_json
 * 파싱 실패면 no-op(베스트 에포트). 반환값 = 갱신된 행 수.
 */
export function updateRunMetaJson(
  db: DatabaseSync,
  run_id: string,
  partial: Record<string, unknown>,
): number {
  const current = getRunMetaJson(db, run_id);
  if (current == null) return 0;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(current) as Record<string, unknown>;
  } catch {
    return 0;
  }
  const merged = JSON.stringify({ ...parsed, ...partial });
  const info = db
    .prepare(`UPDATE bench_runs SET meta_json = @meta_json WHERE run_id = @run_id`)
    .run({ run_id, meta_json: merged });
  return Number(info.changes ?? 0);
}

export type ScenarioRow = {
  scenario_id: string;
  api_route: string;
  aggregate_json: string;
  prompt_preview: string | null;
  prompt_system_preview: string | null;
};

export function listScenariosForRun(db: DatabaseSync, run_id: string): ScenarioRow[] {
  return db
    .prepare(
      `SELECT scenario_id, api_route, aggregate_json, prompt_preview, prompt_system_preview
       FROM bench_scenarios WHERE run_id = ? ORDER BY scenario_id, api_route`,
    )
    .all(run_id) as ScenarioRow[];
}

export type LatestRunRow = RunSummaryRow & { meta_json: string };

/** 각 model_id당 base_url 일치 런 중 finished_at/created_at 최신 1건 */
export function latestFinishedRunsByModels(
  db: DatabaseSync,
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
  /** 측정 런이 있는 시나리오 id들을 콤마로 join — 카테고리(text/vision/agent) 필터용. 없으면 null */
  measured_scenario_ids: string | null;
};

export function listLatestFinishedRunSummaries(db: DatabaseSync): LatestFinishedRunSummary[] {
  return db
    .prepare(
      `SELECT ranked.run_id, ranked.created_at, ranked.finished_at, ranked.base_url, ranked.provider, ranked.model_id, ranked.status,
         (
           SELECT COUNT(*)
           FROM bench_scenarios s
           WHERE s.run_id = ranked.run_id
             AND COALESCE(json_array_length(json_extract(s.aggregate_json, '$.runs')), 0) > 0
         ) AS scenario_count,
         (
           SELECT group_concat(s.scenario_id)
           FROM bench_scenarios s
           WHERE s.run_id = ranked.run_id
             AND COALESCE(json_array_length(json_extract(s.aggregate_json, '$.runs')), 0) > 0
         ) AS measured_scenario_ids
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
