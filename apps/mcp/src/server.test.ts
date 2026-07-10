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

function mockFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const method = init?.method ?? "GET";
  if (url.endsWith("/api/v1/health")) return Promise.resolve(Response.json({ ok: true, service: "mock" }));
  if (url.includes("/api/v1/scenarios")) return Promise.resolve(Response.json({ scenarios: [{ id: "chat_hello" }] }));
  if (url.endsWith("/api/v1/detect")) return Promise.resolve(Response.json({ provider: "lm_studio" }));
  if (url.endsWith("/api/v1/bench/stream")) {
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
});
