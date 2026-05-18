import type { StressRunDetailResponse } from "@llm-bench/shared";
import { describe, expect, it } from "vitest";
import { CSV_BOM, CSV_HEADER_COUNT, stressRunToCsv, stressRunToJson } from "./stress-export";

const baseDetail = (): StressRunDetailResponse => ({
  meta: {
    run_id: "r1",
    created_at: "2026-01-01T00:00:00.000Z",
    base_url: "http://x:1234",
    provider: "lm_studio",
    model_id: "m1",
    api_route: "chat_completions",
    workload_id: "stress_ping",
    max_tokens: 32,
    temperature: 0.7,
    ramp: { start: 1, max: 4, step: 1, durationMs: 5000 },
    request_timeout_ms: 30000,
    worker_prompt_suffix: true,
    status: "ok",
    finished_at: "2026-01-01T00:00:30.000Z",
    error_code: null,
    error_message: null,
  },
  stages: [
    {
      stage_index: 0,
      concurrency: 1,
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
      tps_source: "usage",
    },
  ],
});

describe("stressRunToJson", () => {
  it("returns indented JSON containing meta + stages", () => {
    const s = stressRunToJson(baseDetail());
    expect(s).toContain('"run_id": "r1"');
    expect(s).toContain('"stages"');
    expect(s.split("\n").length).toBeGreaterThan(5); // indented
  });
});

describe("stressRunToCsv", () => {
  it("starts with UTF-8 BOM", () => {
    const s = stressRunToCsv(baseDetail());
    expect(s.startsWith(CSV_BOM)).toBe(true);
  });

  it("has 26 columns in header", () => {
    expect(CSV_HEADER_COUNT).toBe(26);
    const s = stressRunToCsv(baseDetail());
    const headerLine = s.replace(CSV_BOM, "").split("\n")[0];
    expect(headerLine.split(",").length).toBe(26);
  });

  it("escapes commas, quotes, and newlines in values", () => {
    const d = baseDetail();
    d.meta.model_id = 'weird,"model"\nname';
    const s = stressRunToCsv(d);
    const dataLine = s.replace(CSV_BOM, "").split("\n").slice(1).join("\n");
    // 따옴표 escape + 전체 따옴표 wrap
    expect(dataLine).toContain('"weird,""model""\nname"');
  });

  it("emits empty strings for null tps and finished_at", () => {
    const d = baseDetail();
    d.meta.finished_at = null;
    d.stages[0].aggregate_tps = null;
    d.stages[0].tps_per_user = null;
    d.stages[0].latency_ms.p50 = null;
    const s = stressRunToCsv(d);
    const rows = s.replace(CSV_BOM, "").split("\n");
    const cells = rows[1].split(",");
    // finished_at은 3번째 (index 2)
    expect(cells[2]).toBe("");
    // aggregate_tps는 17번째 (index 16)
    expect(cells[16]).toBe("");
  });

  it("emits empty strings when ttft_ms is missing (legacy row)", () => {
    const d = baseDetail();
    // baseDetail()은 ttft_ms 없음
    const s = stressRunToCsv(d);
    const cells = s.replace(CSV_BOM, "").split("\n")[1].split(",");
    // ttft_p50은 22번째 (index 21), ttft_p95는 23번째 (index 22)
    expect(cells[21]).toBe("");
    expect(cells[22]).toBe("");
  });

  it("emits ttft values when present", () => {
    const d = baseDetail();
    d.stages[0].ttft_ms = { p50: 120, p95: 350 };
    const s = stressRunToCsv(d);
    const cells = s.replace(CSV_BOM, "").split("\n")[1].split(",");
    expect(cells[21]).toBe("120");
    expect(cells[22]).toBe("350");
  });
});
