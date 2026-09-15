import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { benchConfig, benchSettingsCanonical } from "./bench-config.js";
import { makeBenchRunMeta } from "./bench-runner.js";
import { finishRun, insertRun, listLatestFinishedRunSummaries, openBenchDatabase, upsertScenarioAggregate } from "./db/database.js";
import { mergedBenchDetailFromDb, mergedBenchDetailFromRunId } from "./db/run-queries.js";
import type { DetectResult } from "@llm-bench/shared";

const detect: DetectResult = { provider: "openai_compatible", baseUrl: "http://localhost:1234", models: [{ id: "m" }], steps: [], capabilities: { openaiChat: true, anthropicMessages: false } };
const meta = (runId: string) => makeBenchRunMeta({ baseUrl: detect.baseUrl, provider: detect.provider, modelId: "m" }, detect, runId);

describe("benchmark settings identity", () => {
  it("ignores object key order, lifecycle, routes, scenario selection and repetition counts", () => {
    const a = { ...meta("a"), effective_sampling: { temperature: 0, top_p: 0.9 } };
    const b = { ...a, run_id: "b", scenario_ids: ["chat_ping"], api_routes: ["messages"], measured_runs: 7, warmup_runs: 0, load_ttl_status: "applied", anthropic_thinking_requested: false, created_at: "other", effective_sampling: { top_p: 0.9, temperature: 0 } };
    expect(benchConfig(a, "a").config_id).toBe(benchConfig(b, "b").config_id);
  });
  it.each([
    { profile_thinking_intent: "off" }, { reasoning_effort: "xhigh" }, { temperature: 0 },
    { max_tokens: 999 }, { seed: 42 }, { scenario_bundle_version: "other" },
    { profile_version: 999 }, { extra_body: { chat_template_kwargs: { enable_thinking: false } } },
  ])("separates workload change %j", (change) => {
    const a = meta("a");
    expect(benchConfig(a, "a").config_id).not.toBe(benchConfig({ ...a, ...change }, "a").config_id);
  });
  it("treats profile_id unknown as complete without profile_version so config_id is stable", () => {
    const mysteryDetect: DetectResult = { ...detect, models: [{ id: "acme/mystery-7b" }] };
    const a = makeBenchRunMeta(
      {
        baseUrl: detect.baseUrl,
        provider: detect.provider,
        modelId: "acme/mystery-7b",
        profile: { thinkingIntent: "on" },
      },
      mysteryDetect,
      "run_a",
    );
    const b = { ...a, run_id: "run_b" };
    expect(a.profile_id).toBe("unknown");
    expect(a.profile_version).toBeUndefined();
    expect(benchConfig(a, "run_a").config_complete).toBe(true);
    expect(benchConfig(a, "run_a").config_id).toBe(benchConfig(b, "run_b").config_id);
  });
  it("isolates incomplete metadata per run without guessing current defaults", () => {
    expect(benchConfig({}, "a").config_complete).toBe(false);
    expect(benchConfig({}, "a").config_id).not.toBe(benchConfig({}, "b").config_id);
  });
  it("settings canonical ignores run isolation so gap-fill can match unknown-profile runs", () => {
    expect(benchSettingsCanonical({ temperature: 0.2, max_tokens: 512 })).toBe(
      benchSettingsCanonical({ temperature: 0.2, max_tokens: 512, run_id: "other" }),
    );
  });
  it("separates explicit request budgets even when a profile overwrites root max_tokens", () => {
    const profile = { profileId: "gemma4" as const };
    const a = makeBenchRunMeta({ baseUrl: detect.baseUrl, provider: detect.provider, modelId: "gemma-4", profile, max_tokens: 128 }, detect, "budget-a");
    const b = makeBenchRunMeta({ baseUrl: detect.baseUrl, provider: detect.provider, modelId: "gemma-4", profile, max_tokens: 256 }, detect, "budget-b");
    expect(a.max_tokens).toBe(b.max_tokens);
    expect(benchConfig(a, a.run_id).config_id).not.toBe(benchConfig(b, b.run_id).config_id);
    const legacy = { ...a };
    delete legacy.request_max_tokens;
    expect(benchConfig(legacy, "legacy").config_complete).toBe(false);
  });
  it("merges only within settings and anchors a requested run to its own group", () => {
    const db = openBenchDatabase(":memory:");
    try {
      for (const [id, temperature, scenario] of [["old", 0.2, "chat_hello"], ["same", 0.2, "chat_ping"], ["different", 0.8, "chat_ping"]] as const) {
        const m = { ...meta(id), temperature };
        insertRun(db, { run_id: id, created_at: m.created_at, base_url: m.base_url, provider: m.provider, model_id: m.model_id, meta: m, status: "running" });
        upsertScenarioAggregate(db, { run_id: id, scenario_id: scenario, api_route: "chat_completions", aggregate_json: JSON.stringify({ runs: [{ ttft_ms: 1, total_ms: 10, output_text: id, stream_completed: true }] }), prompt_preview: id, prompt_system_preview: "system" });
        finishRun(db, id, id === "different" ? "cancelled" : "ok");
      }
      const list = listLatestFinishedRunSummaries(db);
      expect(list.map((r) => r.scenario_count).sort()).toEqual([1, 2]);
      const old = mergedBenchDetailFromRunId(db, "old")!;
      expect(old.meta.run_id).toBe("same");
      expect(old.scenarios.map((s) => s.source_run_id).sort()).toEqual(["old", "same"]);
      const latest = mergedBenchDetailFromDb(db, "m", detect.baseUrl)!;
      expect(latest.meta.run_id).toBe("different");
      expect(latest.scenarios).toHaveLength(1);
      expect(latest.meta.config_id).not.toBe(old.meta.config_id);
    } finally { db.close(); }
  });
  it("v6 recomputes stored unknown-profile config_id under the complete-settings rule", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-config-v6-"));
    const path = join(dir, "bench.sqlite");
    try {
      let db = openBenchDatabase(path);
      const mysteryDetect: DetectResult = { ...detect, models: [{ id: "acme/mystery-7b" }] };
      const m = makeBenchRunMeta(
        {
          baseUrl: detect.baseUrl,
          provider: detect.provider,
          modelId: "acme/mystery-7b",
          profile: { thinkingIntent: "on" },
        },
        mysteryDetect,
        "legacy-unknown",
      );
      insertRun(db, {
        run_id: m.run_id,
        created_at: m.created_at,
        base_url: m.base_url,
        provider: m.provider,
        model_id: m.model_id,
        meta: m,
        status: "ok",
      });
      db.prepare("UPDATE bench_runs SET config_id = ? WHERE run_id = ?").run("v1:pre-v6-island", m.run_id);
      db.exec("DELETE FROM schema_migrations WHERE version >= 6");
      db.close();
      db = openBenchDatabase(path);
      expect(db.prepare("SELECT config_id FROM bench_runs WHERE run_id = ?").get(m.run_id)).toMatchObject({
        config_id: benchConfig(m, m.run_id).config_id,
      });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("backfills version 4 databases transactionally and is idempotent", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-config-"));
    const path = join(dir, "bench.sqlite");
    try {
      let db = openBenchDatabase(path);
      const m = meta("legacy");
      insertRun(db, { run_id: m.run_id, created_at: m.created_at, base_url: m.base_url, provider: m.provider, model_id: m.model_id, meta: m, status: "ok" });
      db.exec("DROP INDEX idx_bench_runs_config; ALTER TABLE bench_runs DROP COLUMN config_id; DELETE FROM schema_migrations WHERE version >= 5;");
      db.close();
      for (let i = 0; i < 2; i++) {
        db = openBenchDatabase(path);
        expect(db.prepare("SELECT config_id FROM bench_runs WHERE run_id = 'legacy'").get()).toMatchObject({ config_id: benchConfig(m, m.run_id).config_id });
        expect(db.prepare("SELECT COUNT(*) AS n FROM bench_runs").get()).toMatchObject({ n: 1 });
        db.close();
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
