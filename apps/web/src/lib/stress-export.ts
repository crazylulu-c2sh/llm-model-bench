import type { StressRunDetailResponse } from "@llm-bench/shared";

export const CSV_BOM = "﻿";

export function stressRunToJson(d: StressRunDetailResponse): string {
  return JSON.stringify(d, null, 2);
}

const CSV_HEADER = [
  "run_id",
  "created_at",
  "finished_at",
  "base_url",
  "provider",
  "model_id",
  "workload_id",
  "status",
  "stage_index",
  "concurrency",
  "duration_ms",
  "enqueue_duration_ms",
  "drain_ms",
  "requests_attempted",
  "requests_succeeded",
  "output_tokens_total",
  "aggregate_tps",
  "tps_per_user",
  "tps_unreliable",
  "p50_ms",
  "p95_ms",
  "error_rate",
  "tps_source",
  "script_match_rate",
] as const;

export const CSV_HEADER_COUNT = CSV_HEADER.length;

function csvEsc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function stressRunToCsv(d: StressRunDetailResponse): string {
  const rows = d.stages.map((s) => [
    d.meta.run_id,
    d.meta.created_at,
    d.meta.finished_at ?? "",
    d.meta.base_url,
    d.meta.provider,
    d.meta.model_id,
    d.meta.workload_id,
    d.meta.status,
    s.stage_index,
    s.concurrency,
    s.duration_ms,
    s.enqueue_duration_ms,
    s.drain_ms,
    s.requests_attempted,
    s.requests_succeeded,
    s.output_tokens_total,
    s.aggregate_tps ?? "",
    s.tps_per_user ?? "",
    s.tps_unreliable ?? false,
    s.latency_ms.p50 ?? "",
    s.latency_ms.p95 ?? "",
    s.error_rate,
    s.tps_source,
    s.script_match_rate ?? "",
  ]);
  return (
    CSV_BOM +
    [CSV_HEADER.join(","), ...rows.map((r) => r.map(csvEsc).join(","))].join("\n")
  );
}

export function downloadTextFile(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
