import { afterEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
// DB 경로를 임시로 고정(실데이터 무영향). tryOpenProdBenchDatabase는 최초 요청 때 열림.
process.env.BENCH_DB_PATH = join(tmpdir(), `llm-bench-apptest-${process.pid}.sqlite`);
import type { DetectResult } from "@llm-bench/shared";
import { createApp } from "./app.js";
import { _setRemoteAddrResolverForTest } from "./util/localhost.js";
import { makeBenchRunMeta } from "./bench-runner.js";
import {
  finishRun,
  insertRun,
  tryOpenProdBenchDatabase,
  upsertScenarioAggregate,
} from "./db/database.js";

const app = createApp();
const req = (path: string, init?: RequestInit) => app.request(path, init);

afterEach(() => {
  delete process.env.BENCH_API_KEYS;
  delete process.env.BENCH_TRUST_LOOPBACK;
  delete process.env.BENCH_TRUST_PROXY;
  _setRemoteAddrResolverForTest(null);
});

describe("dual-prefix routing (/api ≡ /api/v1)", () => {
  it("health is served at both prefixes with identical body", async () => {
    const a = await req("/api/health");
    const b = await req("/api/v1/health");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
  });

  it("scenarios served at both prefixes", async () => {
    for (const p of ["/api/scenarios", "/api/v1/scenarios"]) {
      const r = await req(p);
      expect(r.status).toBe(200);
      const j = (await r.json()) as { scenarios: unknown[] };
      expect(Array.isArray(j.scenarios)).toBe(true);
      expect(j.scenarios.length).toBeGreaterThan(0);
    }
  });

  it("unknown /api route → 404", async () => {
    const r = await req("/api/definitely-not-a-route");
    expect(r.status).toBe(404);
  });
});

describe("catalog / scoreboard", () => {
  it("scenarios?set=vision returns only vision", async () => {
    const r = await req("/api/scenarios?set=vision");
    const j = (await r.json()) as { scenarios: Array<{ isVision: boolean }> };
    expect(j.scenarios.length).toBeGreaterThan(0);
    expect(j.scenarios.every((s) => s.isVision)).toBe(true);
  });

  it("scenarios?set=agent returns built-in agent_loop (#79)", async () => {
    const r = await req("/api/v1/scenarios?set=agent");
    const j = (await r.json()) as {
      scenarios: Array<{ id: string; isAgentLoop: boolean; maxTurns: number | null; toolNames: string[] }>;
    };
    expect(j.scenarios.length).toBeGreaterThan(0);
    expect(j.scenarios.every((s) => s.isAgentLoop)).toBe(true);
    const al = j.scenarios.find((s) => s.id === "agent_loop_mock_v1");
    expect(al).toBeDefined();
    expect(al?.maxTurns).toBeGreaterThan(0);
    expect(al?.toolNames.length).toBeGreaterThan(0);
  });

  it("POST /scenarios registers a custom scenario; set=custom lists it; DELETE removes it (#83)", async () => {
    const post = (body: unknown) =>
      req("/api/v1/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    // 잘못된 입력 → 400 + 필드 에러
    const bad = await post({ id: "app_test_custom" }); // system/user/judge 누락
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_scenario");

    // 예약 접두 id → 400
    const reserved = await post({ id: "vision_nope", system: "s", user: "u", judge: { criterion: "c" } });
    expect(reserved.status).toBe(400);

    // 정상 등록 → 201 + descriptor(source=custom)
    const ok = await post({
      id: "app_test_custom",
      system: "You are custom.",
      user: "Do it.",
      tools: [{ name: "lookup" }],
      judge: { criterion: "score the answer", scale: "0-3" },
    });
    expect(ok.status).toBe(201);
    const okJson = (await ok.json()) as { scenario: { id: string; source: string; toolNames: string[] } };
    expect(okJson.scenario.source).toBe("custom");
    expect(okJson.scenario.toolNames).toContain("lookup");

    // set=custom 에 나타남
    const listed = await req("/api/v1/scenarios?set=custom");
    const listJson = (await listed.json()) as { scenarios: Array<{ id: string }> };
    expect(listJson.scenarios.some((s) => s.id === "app_test_custom")).toBe(true);

    // DELETE → 제거
    const del = await req("/api/v1/scenarios/app_test_custom", { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = await req("/api/v1/scenarios?set=custom");
    const afterJson = (await after.json()) as { scenarios: Array<{ id: string }> };
    expect(afterJson.scenarios.some((s) => s.id === "app_test_custom")).toBe(false);

    // 없는 custom 삭제 → 404
    const del404 = await req("/api/v1/scenarios/app_test_custom", { method: "DELETE" });
    expect(del404.status).toBe(404);
  });

  it("catalog returns scenarios + profiles + stressWorkloads", async () => {
    const r = await req("/api/catalog");
    const j = (await r.json()) as Record<string, unknown>;
    expect(Object.keys(j).sort()).toEqual(["profiles", "scenarios", "stressWorkloads"]);
  });

  it("scoreboard requires baseUrl (400) and returns rows array otherwise", async () => {
    expect((await req("/api/scoreboard")).status).toBe(400);
    const r = await req("/api/scoreboard?baseUrl=http://127.0.0.1:1");
    expect(r.status).toBe(200);
    const j = (await r.json()) as { rows: unknown[]; base_url: string };
    expect(Array.isArray(j.rows)).toBe(true);
    expect(j.base_url).toBe("http://127.0.0.1:1");
  });

  it("scoreboard returns per-model×route leak metrics (#80)", async () => {
    const db = tryOpenProdBenchDatabase();
    expect(db).not.toBeNull();
    const baseUrl = "http://127.0.0.1:9099";
    const detect: DetectResult = {
      provider: "openai_compatible",
      baseUrl,
      models: [{ id: "leaky" }],
      steps: [],
      capabilities: { openaiChat: true, anthropicMessages: false },
    };
    const meta = makeBenchRunMeta(
      { baseUrl, provider: "openai_compatible", modelId: "leaky", skipModelLoad: true },
      detect,
      "leak_run_1",
    );
    insertRun(db!, {
      run_id: meta.run_id,
      created_at: meta.created_at,
      base_url: baseUrl,
      provider: meta.provider,
      model_id: meta.model_id,
      meta,
      status: "running",
    });
    upsertScenarioAggregate(db!, {
      run_id: meta.run_id,
      scenario_id: "chat_ping",
      api_route: "chat_completions",
      aggregate_json: JSON.stringify({
        scenario_id: "chat_ping",
        api_route: "chat_completions",
        runs: [
          {
            ttft_ms: 10,
            total_ms: 100,
            output_text: "",
            stream_completed: true,
            usage_output_tokens: 5,
            empty_response: true,
            quality: { pass: false, score: 0 },
          },
          {
            ttft_ms: 20,
            total_ms: 100,
            output_text: "answer",
            stream_completed: true,
            usage_output_tokens: 5,
            reasoning_chars: 20,
            channel_tag_leak_detected: true,
            quality: { pass: true, score: 1 },
          },
        ],
      }),
      prompt_preview: "p",
      prompt_system_preview: "sp",
    });
    finishRun(db!, meta.run_id, "ok");

    const r = await req(`/api/scoreboard?baseUrl=${encodeURIComponent(baseUrl)}`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as {
      leaks?: Array<{
        model_id: string;
        api_route: string;
        thinking_leak_ratio: number | null;
        empty_turn_rate: number;
        channel_tag_leak: number;
        n: number;
      }>;
    };
    expect(Array.isArray(j.leaks)).toBe(true);
    const leak = j.leaks?.find((l) => l.model_id === "leaky" && l.api_route === "chat_completions");
    expect(leak).toBeDefined();
    expect(leak?.n).toBe(2);
    expect(leak?.empty_turn_rate).toBe(0.5); // 1/2
    expect(leak?.channel_tag_leak).toBe(0.5); // 1/2
    expect(leak?.thinking_leak_ratio).toBeCloseTo(0.5, 6); // reasoning 5 tok / total 10 tok
  });

  it("compare (#84) diffs two runs and flags regression; resolves modelA/modelB", async () => {
    const db = tryOpenProdBenchDatabase();
    expect(db).not.toBeNull();
    const baseUrl = "http://127.0.0.1:9097";
    const detect: DetectResult = {
      provider: "lm_studio",
      baseUrl,
      models: [{ id: "cmpA" }, { id: "cmpB" }],
      steps: [],
      capabilities: { openaiChat: true, anthropicMessages: false },
    };
    const seed = (model: string, runId: string, score: number) => {
      const meta = makeBenchRunMeta(
        { baseUrl, provider: "lm_studio", modelId: model, skipModelLoad: true },
        detect,
        runId,
      );
      insertRun(db!, {
        run_id: meta.run_id,
        created_at: meta.created_at,
        base_url: baseUrl,
        provider: meta.provider,
        model_id: meta.model_id,
        meta,
        status: "running",
      });
      upsertScenarioAggregate(db!, {
        run_id: meta.run_id,
        scenario_id: "chat_ping",
        api_route: "chat_completions",
        aggregate_json: JSON.stringify({
          scenario_id: "chat_ping",
          api_route: "chat_completions",
          runs: [
            {
              ttft_ms: 100,
              total_ms: 1000,
              output_text: "x".repeat(40),
              stream_completed: true,
              usage_output_tokens: 100,
              quality: { pass: score >= 0.67, score },
            },
          ],
        }),
        prompt_preview: "p",
        prompt_system_preview: "sp",
      });
      finishRun(db!, meta.run_id, "ok");
    };
    seed("cmpA", "cmp_run_a", 1);
    seed("cmpB", "cmp_run_b", 0.33);

    // 파라미터 없음 → 400
    expect((await req("/api/v1/compare")).status).toBe(400);

    // runA/runB → 200 + quality_drop regression
    const byRun = await req("/api/v1/compare?runA=cmp_run_a&runB=cmp_run_b");
    expect(byRun.status).toBe(200);
    const j = (await byRun.json()) as {
      scenarios: Array<{ scenario: string; regressions: string[] }>;
      summary: { regression: boolean };
    };
    expect(j.summary.regression).toBe(true);
    expect(j.scenarios[0]?.regressions).toContain("quality_drop");

    // 없는 run → 404
    expect((await req("/api/v1/compare?runA=nope&runB=cmp_run_b")).status).toBe(404);

    // modelA/modelB + baseUrl → 최신 런 해석
    const byModel = await req(
      `/api/v1/compare?modelA=cmpA&modelB=cmpB&baseUrl=${encodeURIComponent(baseUrl)}`,
    );
    expect(byModel.status).toBe(200);
    const jm = (await byModel.json()) as { summary: { scenarios_compared: number } };
    expect(jm.summary.scenarios_compared).toBe(1);
  });

  it("scoreboard surfaces memory-fit skipped models (#81) — not silently absent", async () => {
    const db = tryOpenProdBenchDatabase();
    expect(db).not.toBeNull();
    const baseUrl = "http://127.0.0.1:9098";
    const detect: DetectResult = {
      provider: "lm_studio",
      baseUrl,
      models: [{ id: "toobig" }],
      steps: [],
      capabilities: { openaiChat: true, anthropicMessages: false },
    };
    const meta = {
      ...makeBenchRunMeta(
        { baseUrl, provider: "lm_studio", modelId: "toobig", skipModelLoad: false, fitPolicy: "skip" },
        detect,
        "skip_run_1",
      ),
      preflight_memory_fit: {
        model_id: "toobig",
        required_bytes: 26 * 1024 ** 3,
        free_bytes: 14 * 1024 ** 3,
        resident_ram_bytes: 0,
        will_fit: false,
        action: "skip" as const,
        reason: "won't fit — needs 28.6GB, 14.0GB free",
        size_source: "list" as const,
      },
    };
    insertRun(db!, {
      run_id: meta.run_id,
      created_at: meta.created_at,
      base_url: baseUrl,
      provider: meta.provider,
      model_id: meta.model_id,
      meta,
      status: "running",
    });
    // 스킵 런: 측정 시나리오 없음. error_code로 partial 종료.
    finishRun(db!, meta.run_id, "partial", { code: "skipped_wont_fit", message: meta.preflight_memory_fit.reason });

    const r = await req(`/api/scoreboard?baseUrl=${encodeURIComponent(baseUrl)}`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as {
      rows: unknown[];
      skipped?: Array<{ model_id: string; reason: string }>;
    };
    // 측정 런이 없어 랭킹 rows엔 없지만 skipped[]로 노출된다.
    expect(j.rows.length).toBe(0);
    expect(j.skipped?.some((s) => s.model_id === "toobig" && s.reason.includes("won't fit"))).toBe(true);
  });
});

describe("api-key auth (opt-in) + exemptions", () => {
  it("disabled when BENCH_API_KEYS unset (no key → 200)", async () => {
    const r = await req("/api/scenarios");
    expect(r.status).toBe(200);
  });

  it("non-loopback without key → 401; correct Bearer/x-api-key → 200; health/OPTIONS exempt", async () => {
    process.env.BENCH_API_KEYS = "k1,k2";
    _setRemoteAddrResolverForTest(() => "10.0.0.5"); // non-loopback

    expect((await req("/api/scenarios")).status).toBe(401);
    expect((await req("/api/v1/scenarios")).status).toBe(401);
    expect(
      (await req("/api/scenarios", { headers: { Authorization: "Bearer wrong" } })).status,
    ).toBe(401);
    expect(
      (await req("/api/scenarios", { headers: { Authorization: "Bearer k1" } })).status,
    ).toBe(200);
    expect((await req("/api/scenarios", { headers: { "x-api-key": "k2" } })).status).toBe(200);
    // 면제
    expect((await req("/api/health")).status).toBe(200);
    expect((await req("/api/v1/health")).status).toBe(200);
    expect((await req("/api/scenarios", { method: "OPTIONS" })).status).not.toBe(401);
  });

  it("loopback remote is exempt unless BENCH_TRUST_LOOPBACK=0", async () => {
    process.env.BENCH_API_KEYS = "k1";
    _setRemoteAddrResolverForTest(() => "127.0.0.1");
    expect((await req("/api/scenarios")).status).toBe(200); // loopback exempt
    process.env.BENCH_TRUST_LOOPBACK = "0";
    expect((await req("/api/scenarios")).status).toBe(401); // exemption disabled
  });

  it("BENCH_TRUST_PROXY: X-Forwarded-For honored only when enabled", async () => {
    process.env.BENCH_API_KEYS = "k1";
    _setRemoteAddrResolverForTest(() => "172.18.0.9"); // socket peer = proxy (non-loopback)

    // trust-proxy off: XFF ignored → 401
    expect(
      (await req("/api/scenarios", { headers: { "X-Forwarded-For": "127.0.0.1" } })).status,
    ).toBe(401);

    // trust-proxy on: loopback XFF honored → 200
    process.env.BENCH_TRUST_PROXY = "1";
    expect(
      (await req("/api/scenarios", { headers: { "X-Forwarded-For": "127.0.0.1" } })).status,
    ).toBe(200);
    // non-loopback XFF still needs a key
    expect(
      (await req("/api/scenarios", { headers: { "X-Forwarded-For": "8.8.8.8" } })).status,
    ).toBe(401);
  });
});

describe("OpenAPI spec", () => {
  it("serves a valid 3.1 doc with expected schemas + paths (both prefixes)", async () => {
    for (const p of ["/api/openapi.json", "/api/v1/openapi.json"]) {
      const r = await req(p);
      expect(r.status).toBe(200);
      const spec = (await r.json()) as {
        openapi: string;
        paths: Record<string, unknown>;
        components: { schemas: Record<string, unknown> };
      };
      expect(spec.openapi).toBe("3.1.0");
      for (const path of ["/health", "/detect", "/scenarios", "/scoreboard", "/bench/stream"]) {
        expect(spec.paths[path]).toBeDefined();
      }
      for (const s of ["DetectResult", "BenchResult", "StreamEvent", "ScoreboardResponse"]) {
        expect(spec.components.schemas[s]).toBeDefined();
      }
    }
  });

  it("docs page is self-contained HTML (no external src)", async () => {
    const r = await req("/api/v1/docs");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("llm-model-bench API");
    expect(html).not.toMatch(/<script[^>]+src=/i); // 외부 스크립트 없음
  });
});
