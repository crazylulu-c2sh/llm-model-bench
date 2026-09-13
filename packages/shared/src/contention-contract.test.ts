import { describe, expect, it } from "vitest";
import { BenchStreamBodySchema, BenchQueueStartBodySchema, StreamEventSchema } from "./index.js";

describe("contention wait contract", () => {
  it.each([BenchStreamBodySchema.shape.bench, BenchQueueStartBodySchema.shape.bench])("accepts omission and zero, rejects null", (bench) => {
    const field = bench.shape.contentionTotalWaitBudgetMs;
    expect(field.parse(undefined)).toBeUndefined();
    expect(field.parse(0)).toBe(0);
    expect(field.safeParse(null).success).toBe(false);
  });

  it("keeps legacy summaries valid and preserves the new accounting marker", () => {
    const summary = { type: "contention_summary", total_iterations_discarded: 0,
      max_pre_bench_wait_ms: 0, max_between_iteration_wait_ms: 0, total_wait_ms: 0,
      guard_effective: true, gpu_signal_available: false };
    expect(StreamEventSchema.parse(summary)).not.toHaveProperty("wait_accounting_version");
    expect(StreamEventSchema.parse({ ...summary, wait_accounting_version: 2 })).toHaveProperty("wait_accounting_version", 2);
  });
});
