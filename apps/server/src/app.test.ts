import { afterEach, describe, expect, it, vi } from "vitest";
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
  insertStressRun,
  listRecentRuns,
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
    const body = (await a.json()) as {
      ok: boolean;
      service: string;
      wsl_windows_host: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("llm-bench-server");
    expect(body.wsl_windows_host === null || typeof body.wsl_windows_host === "string").toBe(true);
    expect(await b.json()).toEqual(body);
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
    // #101: 하드 예산 변종도 set=agent 에 등록만으로 반영된다.
    const budget = j.scenarios.find((s) => s.id === "agent_loop_budget_v1");
    expect(budget).toBeDefined();
    expect(budget?.isAgentLoop).toBe(true);
    expect(budget?.maxTurns).toBeGreaterThan(0);
  });

  it("scenarios?set=agent descriptor는 category:'agent' 로 라벨된다 (#105)", async () => {
    const r = await req("/api/v1/scenarios?set=agent");
    const j = (await r.json()) as { scenarios: Array<{ id: string; category: string; isVision: boolean }> };
    expect(j.scenarios.length).toBeGreaterThan(0);
    expect(j.scenarios.every((s) => s.category === "agent")).toBe(true);
    expect(j.scenarios.every((s) => s.isVision === false)).toBe(true);
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

  it("scoreboard?task=agent 는 필터를 빌트인 agent_loop 시나리오로 좁힌다 (#105)", async () => {
    const r = await req("/api/scoreboard?baseUrl=http://127.0.0.1:1&task=agent");
    expect(r.status).toBe(200);
    const j = (await r.json()) as { filter?: { task?: string; scenarios?: string[] } };
    expect(j.filter?.task).toBe("agent");
    expect(j.filter?.scenarios).toContain("agent_loop_mock_v1");
    expect(j.filter?.scenarios).toContain("agent_loop_budget_v1");
    // 텍스트/비전 시나리오는 agent task 필터에 없다.
    expect(j.filter?.scenarios).not.toContain("chat_hello");
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

  it("scoreboard returns per-model×route agent_metrics and excludes agent runs from leaks (#105)", async () => {
    const db = tryOpenProdBenchDatabase();
    expect(db).not.toBeNull();
    const baseUrl = "http://127.0.0.1:9095";
    const detect: DetectResult = {
      provider: "openai_compatible",
      baseUrl,
      models: [{ id: "agenty" }],
      steps: [],
      capabilities: { openaiChat: true, anthropicMessages: false },
    };
    const meta = makeBenchRunMeta(
      { baseUrl, provider: "openai_compatible", modelId: "agenty", skipModelLoad: true },
      detect,
      "agent_run_1",
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
      scenario_id: "agent_loop_mock_v1",
      api_route: "chat_completions",
      aggregate_json: JSON.stringify({
        scenario_id: "agent_loop_mock_v1",
        api_route: "chat_completions",
        runs: [
          {
            ttft_ms: 10,
            total_ms: 2000,
            output_text: '{"title":"x"}',
            stream_completed: true,
            usage_output_tokens: 180,
            final_turn_output_tokens: 120,
            turns_to_completion: 4,
            empty_turn_count: 0,
            valid_tool_call_rate: 0.75,
            agent_completion_reason: "completed",
            quality: { pass: true, score: 1 },
          },
          {
            ttft_ms: 10,
            total_ms: 800,
            output_text: "",
            stream_completed: true,
            usage_output_tokens: 300,
            empty_response: true,
            empty_turn_count: 1,
            thinking_exhausted_budget: true,
            agent_completion_reason: "stall",
            quality: { pass: false, score: 0 },
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
      leaks?: Array<{ model_id: string; n: number }>;
      agent_metrics?: Array<{
        model_id: string;
        api_route: string;
        n: number;
        task_completion_rate: number;
        thinking_budget_rate: number;
        task_ms_median: number | null;
        output_efficiency: number | null;
      }>;
    };
    const agent = j.agent_metrics?.find((a) => a.model_id === "agenty" && a.api_route === "chat_completions");
    expect(agent).toBeDefined();
    expect(agent?.n).toBe(2);
    expect(agent?.task_completion_rate).toBe(0.5); // 1/2
    expect(agent?.thinking_budget_rate).toBe(0.5); // 1/2
    expect(agent?.task_ms_median).toBe(2000); // 완료 런만
    expect(agent?.output_efficiency).toBeCloseTo(120 / 180, 6);
    // agent 런은 leaks 에서 제외 → 이 모델의 leaks 행이 없어야 한다(오염 방지).
    expect(j.leaks?.some((l) => l.model_id === "agenty")).toBe(false);
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
      for (const path of [
        "/health",
        "/detect",
        "/scenarios",
        "/scoreboard",
        "/bench/stream",
        // 서버 소유 큐 6종 — 에이전트가 스펙만 보고 큐를 몰 수 있어야 한다.
        "/bench/queue",
        "/bench/queue/{queueId}",
        "/bench/queue/{queueId}/reconnect",
        "/bench/queue/{queueId}/pause",
        "/bench/queue/{queueId}/resume",
        "/bench/queue/{queueId}/stop",
      ]) {
        expect(spec.paths[path]).toBeDefined();
      }
      for (const s of [
        "DetectResult",
        "BenchResult",
        "StreamEvent",
        "ScoreboardResponse",
        "BenchQueueStartBody",
        "BenchQueueSnapshot",
        "BenchQueueStreamEvent",
      ]) {
        expect(spec.components.schemas[s]).toBeDefined();
      }

      // 런 단위 stop/resume은 큐가 아니라 모델 하나에만 걸린다 — 이 경고가 스펙에서 빠지면
      // 에이전트가 "큐를 세웠다"고 착각한 채 다음 모델이 계속 도는 걸 못 본다.
      const runRoutes = spec.paths as Record<
        string,
        { post?: { description?: string; responses?: Record<string, { description?: string }> } }
      >;
      expect(runRoutes["/bench/{runId}/stop"]?.post?.description).toContain("/bench/queue/{queueId}/stop");
      expect(runRoutes["/bench/{runId}/resume"]?.post?.description).toContain("/bench/queue/{queueId}/resume");

      // POST /bench/queue의 409는 두 갈래다(활성 큐=queue_active, 활성 단발 런=run_active).
      // run_active가 스펙에서 빠지면 에이전트가 "단발 런 위에 큐를 올려도 된다"고 읽는다.
      const queuePost = runRoutes["/bench/queue"]?.post;
      expect(queuePost?.responses?.["409"]?.description).toContain("run_active");
      expect(queuePost?.responses?.["409"]?.description).toContain("queue_active");
      // 직렬 실행 락 키는 bench.baseUrl이 아니라 detect.baseUrl이다 — 스펙이 이걸 밝혀야
      // bench.baseUrl만 바꿔 락을 피할 수 있다는 오해가 안 생긴다.
      expect(queuePost?.description).toContain("detect.baseUrl");
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

// #109 후속: 하드 로드 실패(status=partial, 측정 0건)는 rows 에도 안 나오고 skipped 도 preflight 전용이라
// **조용히 사라졌다**(실측: google/gemma-4-31b-qat 2회 연속). skipped 로 노출한다.
describe("scoreboard skipped — 측정 0건 모델 노출 (#109 후속)", () => {
  it("로드 실패로 측정 시나리오가 0건이면 skipped 에 사유와 함께 뜬다", async () => {
    const db = tryOpenProdBenchDatabase();
    expect(db).not.toBeNull();
    const baseUrl = "http://127.0.0.1:9094";
    const detect: DetectResult = {
      provider: "lm_studio",
      baseUrl,
      models: [{ id: "toobig2" }],
      steps: [],
      capabilities: { openaiChat: true, anthropicMessages: false },
    };
    const meta = makeBenchRunMeta(
      { baseUrl, provider: "lm_studio", modelId: "toobig2", skipModelLoad: false },
      detect,
      "loadfail_run_1",
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
    // 측정 시나리오를 하나도 남기지 않고 error 와 함께 partial 종료 = 하드 로드 실패 모양.
    finishRun(db!, meta.run_id, "partial", { code: "load_failed", message: "LM Studio load failed: 500" });

    const r = await req(`/api/scoreboard?baseUrl=${encodeURIComponent(baseUrl)}`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as {
      rows: Array<{ model_id: string }>;
      skipped?: Array<{ model_id: string; reason: string }>;
    };
    // rows 에는 없지만(측정이 없으니) skipped 에는 있어야 한다.
    expect(j.rows.some((x) => x.model_id === "toobig2")).toBe(false);
    const s = j.skipped?.filter((x) => x.model_id === "toobig2") ?? [];
    expect(s).toHaveLength(1); // dedupe — 한 번만
    expect(s[0]!.reason).toContain("no measured scenarios");
    expect(s[0]!.reason).toContain("load failed");
  });
});

// 긴급 정지 선행 작업: /bench/stream의 실행 루프가 응답 스트림 구독과 분리돼 있어,
// 클라이언트가 연결을 끊어도(새로고침 등) 서버에서 끝까지 실행되고 DB에 정상 기록돼야 한다.
describe("bench/stream survives client disconnect (실행 주체 서버 이관)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("cancelling the SSE reader (simulated disconnect) does not abort runBench — the run still finishes as ok", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/v1/chat/completions")) {
        const enc = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"pong"}}]}\n\n'));
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    const baseUrl = "http://127.0.0.1:9095";
    const detect: DetectResult = {
      provider: "lm_studio",
      baseUrl,
      models: [{ id: "disconnect-model" }],
      steps: [],
      capabilities: { openaiChat: true, anthropicMessages: false },
    };

    const resp = await req("/api/bench/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        detect,
        bench: {
          baseUrl,
          provider: "lm_studio",
          modelId: "disconnect-model",
          scenarioIds: ["chat_ping"],
          warmupRuns: 0,
          measuredRuns: 1,
          skipModelLoad: true,
          unloadOtherModels: false,
          autoUnloadAfterBench: false,
          contentionGuardEnabled: false,
        },
      }),
    });
    expect(resp.status).toBe(200);
    expect(resp.body).toBeTruthy();

    const reader = resp.body!.getReader();
    const first = await reader.read(); // run_started
    expect(first.done).toBe(false);
    // 클라이언트 연결 끊김 시뮬레이션 — 응답 스트림의 cancel()이 호출된다.
    await reader.cancel();

    const db = tryOpenProdBenchDatabase();
    expect(db).not.toBeNull();
    await vi.waitFor(
      () => {
        const row = listRecentRuns(db!, 50).find((r) => r.base_url === baseUrl.replace(/\/+$/, ""));
        expect(row?.status).toBe("ok");
      },
      { timeout: 2000, interval: 20 },
    );
  });
});

// 새로고침 후 라이브 재연결: GET /bench/running으로 진행 중인 런을 찾고,
// GET /bench/:runId/reconnect로 지금까지의 이벤트를 replay + 이후 이벤트를 계속 받는다.
describe("bench live reconnect (새로고침 복구)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("GET /bench/running finds the in-progress run, and /reconnect replays buffered events then forwards new ones", async () => {
    const enc = new TextEncoder();
    const controllerBox: { ref: ReadableStreamDefaultController<Uint8Array> | null } = { ref: null };
    const chatStream = new ReadableStream<Uint8Array>({
      start(c) {
        controllerBox.ref = c;
      },
    });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/v1/chat/completions")) {
        return new Response(chatStream, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    const baseUrl = "http://127.0.0.1:9096";
    const detect: DetectResult = {
      provider: "lm_studio",
      baseUrl,
      models: [{ id: "reconnect-model" }],
      steps: [],
      capabilities: { openaiChat: true, anthropicMessages: false },
    };

    const startResp = await req("/api/bench/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        detect,
        bench: {
          baseUrl,
          provider: "lm_studio",
          modelId: "reconnect-model",
          scenarioIds: ["chat_ping"],
          warmupRuns: 0,
          measuredRuns: 1,
          skipModelLoad: true,
          unloadOtherModels: false,
          autoUnloadAfterBench: false,
          contentionGuardEnabled: false,
        },
      }),
    });
    expect(startResp.status).toBe(200);
    const reader = startResp.body!.getReader();
    const decoder = new TextDecoder();
    let seenScenarioStart = false;
    let runId: string | null = null;
    while (!seenScenarioStart) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before scenario_start");
      for (const line of decoder.decode(value).split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const ev = JSON.parse(line.slice(6)) as { type: string; run_id?: string };
        if (ev.type === "run_started") runId = ev.run_id ?? null;
        if (ev.type === "scenario_start") seenScenarioStart = true;
      }
    }
    expect(runId).toBeTruthy();
    // 원 요청 연결을 시뮬레이션상 "새로고침"으로 끊음 — 서버는 계속 실행된다(이전 회귀 테스트가 보장).
    await reader.cancel();

    const runningResp = await req(`/api/bench/running?baseUrl=${encodeURIComponent(baseUrl)}`);
    expect(runningResp.status).toBe(200);
    const runningBody = (await runningResp.json()) as { runs: Array<{ run_id: string; model_id: string }> };
    expect(runningBody.runs.some((r) => r.run_id === runId)).toBe(true);
    expect(runningBody.runs.find((r) => r.run_id === runId)?.model_id).toBe("reconnect-model");

    const reconnectResp = await req(`/api/bench/${runId}/reconnect`);
    expect(reconnectResp.status).toBe(200);
    const reconnectReader = reconnectResp.body!.getReader();
    const seenTypes: string[] = [];
    const readUntilRunFinished = async () => {
      let buf = "";
      while (true) {
        const { value, done } = await reconnectReader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() ?? "";
        for (const chunk of lines) {
          if (!chunk.startsWith("data: ")) continue; // ": ping" 등 SSE 주석 줄 무시
          const ev = JSON.parse(chunk.slice(6)) as { type: string };
          seenTypes.push(ev.type);
          if (ev.type === "run_finished") return;
        }
      }
    };
    const drain = readUntilRunFinished();

    // replay(run_started, model_loaded, scenario_start)가 먼저 도착했는지 확인.
    await vi.waitFor(() => {
      expect(seenTypes).toContain("scenario_start");
    });
    expect(seenTypes[0]).toBe("run_started");

    // 이제 원래 요청을 마저 완료 — 재연결된 구독자에게도 이후 이벤트가 계속 전달돼야 한다.
    controllerBox.ref!.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"pong"}}]}\n\n'));
    controllerBox.ref!.enqueue(enc.encode("data: [DONE]\n\n"));
    controllerBox.ref!.close();

    await drain;
    expect(seenTypes).toContain("metrics_update");
    expect(seenTypes).toContain("run_finished");

    // 런이 끝났으니 더 이상 진행 중 목록에 없어야 한다.
    const runningAfter = await req(`/api/bench/running?baseUrl=${encodeURIComponent(baseUrl)}`);
    const runningAfterBody = (await runningAfter.json()) as { runs: Array<{ run_id: string }> };
    expect(runningAfterBody.runs.some((r) => r.run_id === runId)).toBe(false);
  });

  it("GET /bench/:runId/reconnect for an unknown/finished runId → 404", async () => {
    const r = await req("/api/bench/not-a-real-run/reconnect");
    expect(r.status).toBe(404);
  });
});

describe("base-url-names (Base URL alias)", () => {
  const putBody = (body: unknown) => ({
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  } satisfies RequestInit);

  it("PUT stores with normalized key (trailing slash stripped); GET reflects it", async () => {
    const put = await req(
      "/api/base-url-names",
      putBody({ base_url: "http://10.0.0.9:1234/v1/", name: "Lab Mac" }),
    );
    expect(put.status).toBe(200);
    const putJson = (await put.json()) as { ok: boolean; base_url: string; name: string | null };
    expect(putJson.ok).toBe(true);
    expect(putJson.base_url).toBe("http://10.0.0.9:1234/v1");

    const list = (await (await req("/api/base-url-names")).json()) as {
      items: Array<{ base_url: string; name: string }>;
    };
    expect(list.items.some((it) => it.base_url === "http://10.0.0.9:1234/v1" && it.name === "Lab Mac")).toBe(
      true,
    );
  });

  it("PUT with empty name clears the alias", async () => {
    const put = await req(
      "/api/base-url-names",
      putBody({ base_url: "http://10.0.0.9:1234/v1", name: "" }),
    );
    expect(put.status).toBe(200);
    const putJson = (await put.json()) as { ok: boolean; name: string | null };
    expect(putJson.name).toBe(null);

    const list = (await (await req("/api/base-url-names")).json()) as {
      items: Array<{ base_url: string }>;
    };
    expect(list.items.some((it) => it.base_url === "http://10.0.0.9:1234/v1")).toBe(false);
  });

  it("PUT replaces name+note wholesale; omitted note clears the previous one", async () => {
    const put1 = await req(
      "/api/base-url-names",
      putBody({ base_url: "http://10.0.0.8:5678/v1", name: "DGX Spark", note: "GB200 · 128GB" }),
    );
    expect(put1.status).toBe(200);
    let list = (await (await req("/api/base-url-names")).json()) as {
      items: Array<{ base_url: string; name: string; note?: string }>;
    };
    expect(list.items.find((it) => it.base_url === "http://10.0.0.8:5678/v1")?.note).toBe("GB200 · 128GB");

    // 재PUT 시 note 미전달 → 전역 대체로 비고만 지워지고 이름은 유지.
    const put2 = await req(
      "/api/base-url-names",
      putBody({ base_url: "http://10.0.0.8:5678/v1", name: "DGX Spark" }),
    );
    expect(put2.status).toBe(200);
    list = (await (await req("/api/base-url-names")).json()) as {
      items: Array<{ base_url: string; name: string; note?: string }>;
    };
    const row = list.items.find((it) => it.base_url === "http://10.0.0.8:5678/v1");
    expect(row?.name).toBe("DGX Spark");
    expect(row?.note ?? "").toBe("");
  });

  it("invalid body → 400 with field detail", async () => {
    const r = await req("/api/base-url-names", putBody({ base_url: "", name: "x" }));
    expect(r.status).toBe(400);
    const j = (await r.json()) as { error: string; detail?: unknown };
    expect(j.error).toBe("invalid_body");
    expect(j.detail).toBeTruthy();
  });

  it("served at both prefixes (/api ≡ /api/v1)", async () => {
    const a = await req("/api/base-url-names");
    const b = await req("/api/v1/base-url-names");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  // 다른 오리진에 웹을 올린 구성(BENCH_CORS_ORIGINS)에서 JSON PUT은 preflight를 탄다.
  // allowMethods에 PUT이 없으면 저장이 브라우저 단계에서 전부 막힌다.
  it("CORS preflight advertises PUT for the alias route", async () => {
    const r = await req("/api/base-url-names", {
      method: "OPTIONS",
      headers: {
        origin: "http://example.test",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type",
      },
    });
    expect(r.status).toBeLessThan(400);
    const allowed = (r.headers.get("access-control-allow-methods") ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase());
    expect(allowed).toContain("PUT");
  });
});

describe("publisher exposure (#151)", () => {
  // 두 엔드포인트의 매핑과 레거시 폴백은 PR #151의 간판 주장인데 어느 계층에서도 검증되지 않았다.
  // 매핑 줄을 지우거나 `||` 순서를 뒤집어도 전부 통과하던 상태를 여기서 막는다.
  const BASE = "http://127.0.0.1:9151";

  /** detect publisher와 model_id의 org 접두를 일부러 다르게 둬서 어느 쪽이 쓰였는지 구분한다. */
  function benchDetect(modelId: string, publisher?: string): DetectResult {
    return {
      provider: "openai_compatible",
      baseUrl: BASE,
      models: [{ id: modelId, ...(publisher ? { publisher } : {}) }],
      steps: [],
      capabilities: { openaiChat: true, anthropicMessages: false },
    };
  }

  function insertFinishedBenchRun(runId: string, modelId: string, opts: { legacy?: boolean; publisher?: string } = {}) {
    const db = tryOpenProdBenchDatabase();
    expect(db).not.toBeNull();
    const full = makeBenchRunMeta(
      { baseUrl: BASE, provider: "openai_compatible", modelId, skipModelLoad: true },
      benchDetect(modelId, opts.publisher),
      runId,
    );
    // 레거시 런 = #151 이전에 기록돼 meta_json에 publisher 키가 아예 없는 런.
    const { publisher: _dropped, ...withoutPublisher } = full;
    const meta = opts.legacy ? withoutPublisher : full;
    insertRun(db!, {
      run_id: runId,
      created_at: full.created_at,
      base_url: BASE,
      provider: full.provider,
      model_id: modelId,
      meta,
      status: "running",
    });
    finishRun(db!, runId, "ok");
  }

  it("GET /stats/model-latest: 신규 런은 meta_json.publisher, 레거시 런은 id 접두 폴백", async () => {
    insertFinishedBenchRun("pub_new_1", "prefix-org/model-n", { publisher: "Detect Org" });
    insertFinishedBenchRun("pub_legacy_1", "legacy-org/model-l", { legacy: true });
    insertFinishedBenchRun("pub_none_1", "bare-model-no-org", { legacy: true });

    const r = await req("/api/stats/model-latest");
    expect(r.status).toBe(200);
    const j = (await r.json()) as { items: Array<{ model_id: string; publisher?: string }> };
    const by = (id: string) => j.items.find((it) => it.model_id === id);

    // 저장된 publisher가 id 접두("prefix-org")보다 우선해야 한다 — `||` 순서를 뒤집으면 깨진다.
    expect(by("prefix-org/model-n")?.publisher).toBe("Detect Org");
    // meta_json에 publisher가 없는 기존 런은 id 접두에서 파생.
    expect(by("legacy-org/model-l")?.publisher).toBe("legacy-org");
    // 둘 다 없으면 필드를 내보내지 않는다(빈 문자열 아님).
    expect(by("bare-model-no-org")?.publisher).toBeUndefined();
  });

  it("GET /stress/runs: 신규 런은 meta_json.publisher, 레거시 런은 id 접두 폴백", async () => {
    const db = tryOpenProdBenchDatabase();
    expect(db).not.toBeNull();
    const seedStress = (runId: string, modelId: string, publisher?: string) => {
      insertStressRun(db!, {
        run_id: runId,
        created_at: new Date(2026, 5, 1, 12, 0, 0).toISOString(),
        base_url: BASE,
        provider: "lm_studio",
        model_id: modelId,
        workload_id: "stress_ping",
        meta_json: JSON.stringify({
          run_id: runId,
          base_url: BASE,
          model_id: modelId,
          workload_id: "stress_ping",
          ...(publisher ? { publisher } : {}),
        }),
        status: "ok",
      });
    };
    seedStress("spub_new_1", "prefix-org/model-s", "Detect Org S");
    seedStress("spub_legacy_1", "legacy-org/model-t");
    seedStress("spub_none_1", "bare-stress-model");

    const r = await req(`/api/stress/runs?base_url=${encodeURIComponent(BASE)}&limit=50`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { items: Array<{ model_id: string; publisher?: string }> };
    const by = (id: string) => j.items.find((it) => it.model_id === id);

    expect(by("prefix-org/model-s")?.publisher).toBe("Detect Org S");
    expect(by("legacy-org/model-t")?.publisher).toBe("legacy-org");
    expect(by("bare-stress-model")?.publisher).toBeUndefined();
  });
});
