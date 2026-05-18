import type { StressRunMeta, StressRunStatus } from "@llm-bench/shared";
import { describe, expect, it } from "vitest";
import {
  deleteStressRun,
  getStressFilterOptions,
  getStressRunMeta,
  insertStressRun,
  listStressRunsFiltered,
  listStressStages,
  openBenchDatabase,
  upsertStressStage,
  type StressRunListOpts,
} from "./database.js";

const META_BASE: StressRunMeta = {
  run_id: "",
  created_at: new Date(2026, 0, 1).toISOString(),
  base_url: "http://x:1234",
  provider: "lm_studio",
  model_id: "m1",
  api_route: "chat_completions",
  workload_id: "stress_ping",
  max_tokens: 32,
  temperature: 0.7,
  ramp: { start: 1, max: 8, step: 1, durationMs: 5000 },
  request_timeout_ms: 30000,
  worker_prompt_suffix: true,
};

function seed(opts: {
  run_id: string;
  created_at?: string;
  base_url?: string;
  model_id?: string;
  workload_id?: string;
  status?: StressRunStatus;
  stages?: number;
}) {
  return (db: ReturnType<typeof openBenchDatabase>) => {
    const created_at = opts.created_at ?? new Date(2026, 0, 1, 12, 0, 0).toISOString();
    const base_url = opts.base_url ?? "http://x:1234";
    const model_id = opts.model_id ?? "m1";
    const workload_id = opts.workload_id ?? "stress_ping";
    insertStressRun(db, {
      run_id: opts.run_id,
      created_at,
      base_url,
      provider: "lm_studio",
      model_id,
      workload_id,
      meta_json: JSON.stringify({ ...META_BASE, run_id: opts.run_id, base_url, model_id, workload_id }),
      status: opts.status ?? "ok",
    });
    for (let i = 0; i < (opts.stages ?? 1); i++) {
      upsertStressStage(db, {
        run_id: opts.run_id,
        stage_index: i,
        concurrency: i + 1,
        result_json: JSON.stringify({
          duration_ms: 5000,
          enqueue_duration_ms: 100,
          drain_ms: 50,
          requests_attempted: 10,
          requests_succeeded: 10,
          output_tokens_total: 200,
          aggregate_tps: 40,
          tps_per_user: 40,
          latency_ms: { p50: 100, p95: 200 },
          error_rate: 0,
          tps_source: "usage" as const,
        }),
      });
    }
  };
}

function opts(over: Partial<StressRunListOpts> = {}): StressRunListOpts {
  return { limit: 50, ...over };
}

describe("listStressRunsFiltered", () => {
  it("returns all rows DESC when no filters", () => {
    const db = openBenchDatabase(":memory:");
    seed({ run_id: "r1", created_at: "2026-01-01T10:00:00.000Z" })(db);
    seed({ run_id: "r2", created_at: "2026-01-01T11:00:00.000Z" })(db);
    seed({ run_id: "r3", created_at: "2026-01-01T12:00:00.000Z" })(db);
    const rows = listStressRunsFiltered(db, opts());
    expect(rows.map((r) => r.run_id)).toEqual(["r3", "r2", "r1"]);
  });

  it("filters by workload_id + status", () => {
    const db = openBenchDatabase(":memory:");
    seed({ run_id: "a", workload_id: "stress_ping", status: "ok" })(db);
    seed({ run_id: "b", workload_id: "stress_short_reply_ko", status: "ok" })(db);
    seed({ run_id: "c", workload_id: "stress_ping", status: "error" })(db);
    const rows = listStressRunsFiltered(db, opts({ workload_id: "stress_ping", status: "ok" }));
    expect(rows.map((r) => r.run_id)).toEqual(["a"]);
  });

  it("normalizes base_url trailing slash for filter (RTRIM)", () => {
    const db = openBenchDatabase(":memory:");
    seed({ run_id: "slash", base_url: "http://host:1234/" })(db);
    seed({ run_id: "noslash", base_url: "http://host:1234" })(db);
    seed({ run_id: "other", base_url: "http://other:9999" })(db);
    const rows = listStressRunsFiltered(db, opts({ base_url: "http://host:1234" }));
    expect(rows.map((r) => r.run_id).sort()).toEqual(["noslash", "slash"]);
  });

  it("cursor pagination is stable (created_at tiebreaker by run_id)", () => {
    const db = openBenchDatabase(":memory:");
    const ts = "2026-01-01T12:00:00.000Z";
    seed({ run_id: "a", created_at: ts })(db);
    seed({ run_id: "b", created_at: ts })(db);
    seed({ run_id: "c", created_at: ts })(db);
    const page1 = listStressRunsFiltered(db, opts({ limit: 2 }));
    expect(page1.map((r) => r.run_id)).toEqual(["c", "b"]);
    const last = page1[page1.length - 1];
    const page2 = listStressRunsFiltered(db, opts({ limit: 2, before_created_at: last.created_at, before_run_id: last.run_id }));
    expect(page2.map((r) => r.run_id)).toEqual(["a"]);
  });

  it("returns empty when no match", () => {
    const db = openBenchDatabase(":memory:");
    seed({ run_id: "r1" })(db);
    const rows = listStressRunsFiltered(db, opts({ model_id: "nope" }));
    expect(rows).toEqual([]);
  });
});

describe("getStressFilterOptions", () => {
  it("returns distinct sorted values from 4 columns", () => {
    const db = openBenchDatabase(":memory:");
    seed({ run_id: "a", workload_id: "stress_ping", status: "ok", model_id: "m1", base_url: "http://a:1" })(db);
    seed({ run_id: "b", workload_id: "stress_short_reply_ko", status: "partial", model_id: "m2", base_url: "http://b:2" })(db);
    seed({ run_id: "c", workload_id: "stress_ping", status: "ok", model_id: "m1", base_url: "http://a:1" })(db);
    const fo = getStressFilterOptions(db);
    expect(fo.workload_ids).toEqual(["stress_ping", "stress_short_reply_ko"]);
    expect(fo.statuses).toEqual(["ok", "partial"]);
    expect(fo.model_ids).toEqual(["m1", "m2"]);
    expect(fo.base_urls).toEqual(["http://a:1", "http://b:2"]);
  });
});

describe("getStressRunMeta", () => {
  it("returns row with meta_json + error fields, or null when missing", () => {
    const db = openBenchDatabase(":memory:");
    seed({ run_id: "r1" })(db);
    const row = getStressRunMeta(db, "r1");
    expect(row?.run_id).toBe("r1");
    expect(row?.meta_json).toContain("stress_ping");
    expect(getStressRunMeta(db, "missing")).toBeNull();
  });
});

describe("deleteStressRun", () => {
  it("cascades to stress_stages (FK)", () => {
    const db = openBenchDatabase(":memory:");
    seed({ run_id: "r1", stages: 3 })(db);
    expect(listStressStages(db, "r1")).toHaveLength(3);
    const changes = deleteStressRun(db, "r1");
    expect(changes).toBe(1);
    expect(listStressStages(db, "r1")).toHaveLength(0);
    expect(getStressRunMeta(db, "r1")).toBeNull();
  });

  it("returns 0 when run not found", () => {
    const db = openBenchDatabase(":memory:");
    expect(deleteStressRun(db, "missing")).toBe(0);
  });
});
