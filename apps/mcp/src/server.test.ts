import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./server.js";
import type { McpConfig } from "./config.js";

const cfg: McpConfig = {
  benchApiUrl: "http://mock",
  apiVersion: "/api/v1",
  transport: "stdio",
  httpHost: "127.0.0.1",
  httpPort: 0,
  allowedHosts: [],
  allowedOrigins: [],
  httpTimeoutMs: 5000,
};

function sseResponse(frames: string[], signal?: AbortSignal, hangAfter = false): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      if (hangAfter) {
        // abort 신호가 오면 read를 reject(실 fetch 동작 모사) → 타임아웃 경로 테스트.
        signal?.addEventListener("abort", () => {
          try {
            controller.error(new DOMException("aborted", "AbortError"));
          } catch {
            /* already closed */
          }
        });
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const detail = {
  meta: { model_id: "m1" },
  scenarios: [
    {
      id: "chat_hello",
      api_route: "chat_completions",
      runs: [
        { ttft_ms: 100, total_ms: 1000, output_text: "hello world", usage_output_tokens: 10, quality: { pass: true, score: 1 } },
        { ttft_ms: 120, total_ms: 1000, output_text: "hello world", usage_output_tokens: 10, quality: { pass: true, score: 1 } },
      ],
    },
  ],
};

let hangBench = false;
/** 남은 409(queue_active) 응답 수 — 서버 큐가 baseUrl을 점유한 상황 모사. */
let benchStream409Left = 0;
/** `/bench/running`의 queues 응답을 폴링 순서대로. 소진되면 마지막 값을 계속 돌려준다. */
let runningQueuesSeq: Array<Array<Record<string, unknown>>> = [[]];

function nextRunningQueues(): Array<Record<string, unknown>> {
  return runningQueuesSeq.length > 1 ? runningQueuesSeq.shift()! : runningQueuesSeq[0];
}

function mockFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const method = init?.method ?? "GET";
  if (url.endsWith("/api/v1/health")) return Promise.resolve(Response.json({ ok: true, service: "mock" }));
  if (url.includes("/api/v1/scenarios")) return Promise.resolve(Response.json({ scenarios: [{ id: "chat_hello" }] }));
  if (url.endsWith("/api/v1/detect")) return Promise.resolve(Response.json({ provider: "lm_studio" }));
  if (url.includes("/api/v1/bench/running")) {
    return Promise.resolve(Response.json({ runs: [], queues: nextRunningQueues() }));
  }
  if (url.endsWith("/api/v1/bench/stream")) {
    if (benchStream409Left > 0) {
      benchStream409Left -= 1;
      return Promise.resolve(
        Response.json(
          {
            error: "queue_active",
            message: "이 baseUrl에서 서버 벤치 큐가 실행 중입니다. 큐가 끝난 뒤 다시 시도하세요.",
            base_url: "http://prov",
            queue_id: "Q1",
            model_id: "m9",
          },
          { status: 409 },
        ),
      );
    }
    const frames = [
      `data: {"type":"run_started","run_id":"R1","meta":{"scenario_ids":["chat_hello"]}}\n\n`,
      `data: {"type":"scenario_end","scenario_id":"chat_hello","api_route":"chat_completions","metrics":{"ttft_ms":110,"total_ms":1000,"output_chars":11,"usage_output_tokens":10,"stream_completed":true},"quality":{"pass":true,"score":1}}\n\n`,
    ];
    if (!hangBench) frames.push(`data: {"type":"run_finished","run_id":"R1"}\n\n`);
    return Promise.resolve(sseResponse(frames, init?.signal ?? undefined, hangBench));
  }
  if (url.includes("/api/v1/runs/R1")) return Promise.resolve(Response.json(detail));
  return Promise.resolve(new Response("not found", { status: 404 }));
}

async function connectClient(cfgOverride?: Partial<McpConfig>) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ ...cfg, ...cfgOverride });
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientT);
  return client;
}

function parseText(res: { content: Array<{ type: string; text?: string }> }): any {
  const t = res.content.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(t);
}

beforeEach(() => {
  hangBench = false;
  benchStream409Left = 0;
  runningQueuesSeq = [[]];
  vi.stubGlobal("fetch", vi.fn(mockFetch));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MCP server (in-memory client)", () => {
  it("exposes the expected tool catalog", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "compare_models",
        "compare_runs",
        "detect_provider",
        "get_run",
        "health",
        "list_capabilities",
        "list_runs",
        "list_scenarios",
        "monitor_snapshot",
        "run_bench",
        "run_stress",
      ].sort(),
    );
  });

  it("list_scenarios proxies GET /scenarios", async () => {
    const client = await connectClient();
    const res = (await client.callTool({ name: "list_scenarios", arguments: {} })) as any;
    expect(parseText(res).scenarios[0].id).toBe("chat_hello");
  });

  it("run_bench drains SSE, fetches canonical, returns compact result", async () => {
    const client = await connectClient();
    const res = (await client.callTool({
      name: "run_bench",
      arguments: { baseUrl: "http://prov", modelId: "m1", scenarioIds: ["chat_hello"] },
    })) as any;
    const out = parseText(res);
    expect(out.run_id).toBe("R1");
    expect(out.status).toBe("ok");
    expect(out.model_id).toBe("m1");
    expect(out.scenarios).toHaveLength(1);
    expect(out.scenarios[0].id).toBe("chat_hello");
    expect(out.scenarios[0].tps).toBeGreaterThan(0);
    expect(out.rollup).toBeTruthy();
    expect(out.rollup.quality.value).toBe(100);
  });

  it("run_bench times out but recovers canonical run (serverKeepsRunning)", async () => {
    hangBench = true;
    const client = await connectClient({ httpTimeoutMs: 200 });
    const res = (await client.callTool({
      name: "run_bench",
      arguments: { baseUrl: "http://prov", modelId: "m1" },
    })) as any;
    const out = parseText(res);
    expect(out.status).toBe("timeout");
    expect(out.serverKeepsRunning).toBe(true);
    expect(out.run_id).toBe("R1"); // run_started was seen before the hang
  }, 15000);

  it("run_bench는 409의 본문 사유(queue_active·queue_id)를 에러 메시지에 담는다", async () => {
    benchStream409Left = 99;
    const client = await connectClient();
    const res = (await client.callTool({
      name: "run_bench",
      arguments: { baseUrl: "http://prov", modelId: "m1" },
    })) as any;
    expect(res.isError).toBe(true);
    const out = parseText(res);
    expect(out.error).toContain("409");
    expect(out.error).toContain("queue_active");
    expect(out.error).toContain("queue_id=Q1"); // 본문의 스칼라 필드가 그대로 풀려 나온다
    expect(out.error).toContain("waitForIdleMs"); // 다음 행동을 알려준다
    expect(out.data.queue_id).toBe("Q1");
    expect(out.data.queue_model_id).toBe("m9");
  });

  it("waitForIdleMs를 주면 큐가 빈 뒤 자동 재시도한다(완료 큐는 점유로 안 센다)", async () => {
    benchStream409Left = 1;
    // TTL 안의 *완료* 큐가 목록에 남아도 idle이어야 한다 — 목록 유무로 판단하면 영영 못 기다린다.
    runningQueuesSeq = [[{ queue_id: "Q1", status: "finished", models: [] }]];
    const client = await connectClient();
    const res = (await client.callTool({
      name: "run_bench",
      arguments: { baseUrl: "http://prov", modelId: "m1", waitForIdleMs: 300 },
    })) as any;
    const out = parseText(res);
    expect(out.status).toBe("ok");
    expect(out.run_id).toBe("R1");
  }, 15000);

  it("waitForIdleMs를 넘겨도 큐가 안 비면 명확한 메시지로 실패한다", async () => {
    benchStream409Left = 99;
    runningQueuesSeq = [[{ queue_id: "Q1", status: "running", index: 0, models: [{ model_id: "m9" }] }]];
    const client = await connectClient();
    const res = (await client.callTool({
      name: "run_bench",
      arguments: { baseUrl: "http://prov", modelId: "m1", waitForIdleMs: 120 },
    })) as any;
    expect(res.isError).toBe(true);
    const out = parseText(res);
    expect(out.error).toContain("waitForIdleMs=120ms");
    expect(out.data.queue_id).toBe("Q1");
  }, 15000);
});
