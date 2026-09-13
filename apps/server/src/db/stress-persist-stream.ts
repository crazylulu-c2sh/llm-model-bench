import type { StressRunMeta, StressStreamEvent } from "@llm-bench/shared";
import type { DatabaseSync } from "node:sqlite";
import {
  finishStressRun,
  insertStressRun,
  markStressRunErrorPartial,
  updateStressRunMetaJson,
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
  private cancelled = false;
  private completedMeasurements = 0;
  private warnings: Array<Record<string, unknown>> = [];

  constructor(private readonly db: DatabaseSync | null) {}

  start(meta: StressRunMeta): void {
    if (!this.db) return;
    this.runId = meta.run_id;
    this.hadError = false;
    this.cancelled = false;
    this.completedMeasurements = 0;
    this.warnings = [];
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
        this.completedMeasurements += r.requests_succeeded > 0 ? 1 : 0;
        break;
      }
      case "warning":
        this.warnings.push({ code: ev.code, message: ev.message, ...(ev.requested !== undefined ? { requested: ev.requested } : {}), ...(ev.observed !== undefined ? { observed: ev.observed } : {}) });
        updateStressRunMetaJson(this.db, this.runId, { warnings: this.warnings });
        break;
      case "run_finished":
        this.cancelled = ev.status === "cancelled";
        break;
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
    const status = this.cancelled
      ? "cancelled"
      : this.hadError
        ? this.completedMeasurements > 0 ? "partial" : "error"
        : this.completedMeasurements > 0 ? "ok" : "error";
    updateStressRunMetaJson(this.db, this.runId, {
      completed_measurements: this.completedMeasurements,
      ...(this.warnings.length ? { warnings: this.warnings } : {}),
    });
    finishStressRun(this.db, this.runId, status);
    this.runId = null;
  }
}
