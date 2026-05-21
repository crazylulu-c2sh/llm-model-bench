import type { StressRunMeta, StressStreamEvent } from "@llm-bench/shared";
import type { DatabaseSync } from "node:sqlite";
import {
  finishStressRun,
  insertStressRun,
  markStressRunErrorPartial,
  upsertStressStage,
} from "./database.js";

/**
 * 프로바이더 벤치(SSE)를 SQLite `stress_runs`/`stress_stages`에 기록.
 * bench-runner의 `BenchRunPersistence`와 같은 인터페이스(`start`/`onEvent`/`finalize`).
 * 텍스트 로그는 v1 미지원 (SSE 트레이스로 충분).
 */
export class StressRunPersistence {
  private runId: string | null = null;
  private hadError = false;

  constructor(private readonly db: DatabaseSync | null) {}

  start(meta: StressRunMeta): void {
    if (!this.db) return;
    this.runId = meta.run_id;
    this.hadError = false;
    insertStressRun(this.db, {
      run_id: meta.run_id,
      created_at: meta.created_at,
      base_url: meta.base_url.replace(/\/+$/, ""),
      provider: meta.provider,
      model_id: meta.model_id,
      workload_id: meta.workload_id,
      meta_json: JSON.stringify(meta),
      status: "running",
    });
  }

  onEvent(ev: StressStreamEvent): void {
    if (!this.db || !this.runId) return;
    switch (ev.type) {
      case "stress_stage_finished": {
        const r = ev.result;
        upsertStressStage(this.db, {
          run_id: this.runId,
          stage_index: r.stage_index,
          concurrency: r.concurrency,
          result_json: JSON.stringify(r),
        });
        break;
      }
      case "error": {
        this.hadError = true;
        markStressRunErrorPartial(this.db, this.runId, ev.code, ev.message);
        break;
      }
      default:
        break;
    }
  }

  finalize(): void {
    if (!this.db || !this.runId) return;
    finishStressRun(this.db, this.runId, this.hadError ? "partial" : "ok");
    this.runId = null;
  }
}
