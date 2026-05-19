import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetLmsCliCacheForTest,
  _setExecFileForTest,
} from "./lms-cli";
import {
  collectLmStudioLoaded,
  collectOllamaLoaded,
  parseLmsPsOutput,
} from "./monitor-collect";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  _resetLmsCliCacheForTest();
});
afterEach(() => {
  _setExecFileForTest(null);
  _resetLmsCliCacheForTest();
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

describe("parseLmsPsOutput", () => {
  it("parses JSON array", () => {
    const out = JSON.stringify([
      { id: "m1", name: "Model 1", vram_bytes: 1000 },
      { identifier: "m2" },
    ]);
    const r = parseLmsPsOutput(out);
    expect(r).toHaveLength(2);
    expect(r[0].id).toBe("m1");
    expect(r[0].vramBytes).toBe(1000);
    expect(r[1].id).toBe("m2");
  });

  it("parses JSON object with models[]", () => {
    const out = JSON.stringify({ models: [{ id: "x" }] });
    expect(parseLmsPsOutput(out)).toEqual([
      { id: "x", name: undefined, vramBytes: undefined, ramBytes: undefined, contextLength: undefined, raw: { id: "x" } },
    ]);
  });

  it("falls back to plain text rows", () => {
    const out = "ID  NAME\nllama-3-70b  Llama 3 70B\nmistral  Mistral\n";
    const r = parseLmsPsOutput(out);
    expect(r).toHaveLength(2);
    expect(r[0].id).toBe("llama-3-70b");
  });

  it("returns [] for empty/single-line", () => {
    expect(parseLmsPsOutput("")).toEqual([]);
    expect(parseLmsPsOutput("just-header")).toEqual([]);
  });
});

describe("collectLmStudioLoaded — HTTP path", () => {
  it("returns http source with loaded instances", async () => {
    const mockResponse = {
      models: [
        {
          key: "publisher/model",
          loaded_instances: [{ id: "inst-1", vram_usage: 2048, context_length: 8192 }],
        },
      ],
    };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockResponse),
    })) as unknown as typeof fetch;

    const r = await collectLmStudioLoaded("http://127.0.0.1:1234", { allowCli: true });
    expect(r.source).toBe("http");
    expect(r.loaded).toHaveLength(1);
    expect(r.loaded[0].id).toBe("inst-1");
    expect(r.loaded[0].vramBytes).toBe(2048);
    expect(r.loaded[0].contextLength).toBe(8192);
  });
});

describe("collectLmStudioLoaded — CLI fallback gating", () => {
  beforeEach(() => {
    // HTTP는 항상 실패하도록
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
    })) as unknown as typeof fetch;
  });

  it("calls lms ps when allowCli=true and env on", async () => {
    process.env.ENABLE_LMS_CLI = "1";
    let lmsCalled = 0;
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      lmsCalled += 1;
      cb?.(null, '[{"id":"from-cli"}]', "");
      return {} as never;
    }) as never);
    const r = await collectLmStudioLoaded("http://127.0.0.1:1234", { allowCli: true });
    expect(lmsCalled).toBeGreaterThanOrEqual(1);
    expect(r.source).toBe("cli");
    expect(r.loaded[0].id).toBe("from-cli");
  });

  it("does NOT call lms ps when allowCli=false even with env on", async () => {
    process.env.ENABLE_LMS_CLI = "1";
    let lmsCalled = 0;
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      lmsCalled += 1;
      cb?.(null, '[{"id":"from-cli"}]', "");
      return {} as never;
    }) as never);
    const r = await collectLmStudioLoaded("http://127.0.0.1:1234", { allowCli: false });
    expect(lmsCalled).toBe(0);
    expect(r.source).toBe("none");
    expect(r.loaded).toEqual([]);
    expect(r.cli).toBeUndefined();
  });

  it("does NOT call lms ps when allowCli=true but env off", async () => {
    delete process.env.ENABLE_LMS_CLI;
    let lmsCalled = 0;
    _setExecFileForTest(((file: any, args: any, opts: any, cb: any) => {
      lmsCalled += 1;
      cb?.(null, '[]', "");
      return {} as never;
    }) as never);
    const r = await collectLmStudioLoaded("http://127.0.0.1:1234", { allowCli: true });
    // lmsPs는 env off 시 throw → catch로 source=none
    expect(lmsCalled).toBe(0);
    expect(r.source).toBe("none");
    expect(r.cli?.ok).toBe(false);
  });
});

describe("collectLmStudioLoaded — HTTP timeout", () => {
  it("passes AbortSignal (timeout) to fetch (5s)", async () => {
    const seenSignals: (AbortSignal | null)[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seenSignals.push(init?.signal ?? null);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ models: [] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    await collectLmStudioLoaded("http://127.0.0.1:1234", { allowCli: false });
    // 한 번 이상 fetch가 signal을 받았어야 한다 (AbortSignal.timeout가 전달됐는지).
    const signal = seenSignals[0];
    expect(signal).not.toBeNull();
    expect(signal!.aborted).toBe(false);
  });

  it("shares a single timeout signal across v1/v0 candidates (caps total timeout)", async () => {
    // patch A 회귀 가드: lmStudioListModels는 v1 → v0 직렬 fallback인데,
    // 각 candidate마다 새 AbortSignal.timeout()을 만들면 10s 누적. 단일 signal 공유로 5s cap.
    const seenSignals: AbortSignal[] = [];
    let callCount = 0;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      callCount += 1;
      if (init?.signal) seenSignals.push(init.signal);
      // 첫 번째 candidate(v1)는 404 → 두 번째(v0)로 fallback
      if (callCount === 1) {
        return { ok: false, status: 404, text: async () => "" } as unknown as Response;
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ models: [] }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await collectLmStudioLoaded("http://127.0.0.1:1234", { allowCli: false });
    expect(callCount).toBe(2);
    expect(seenSignals).toHaveLength(2);
    // 동일 signal 인스턴스가 두 번 전달돼야 한다.
    expect(seenSignals[0]).toBe(seenSignals[1]);
  });
});

describe("collectOllamaLoaded", () => {
  it("parses /api/ps models", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        models: [
          { name: "llama3:8b", model: "llama3:8b", size_vram: 5_000_000_000, size: 8_000_000_000 },
        ],
      }),
    })) as unknown as typeof fetch;
    const r = await collectOllamaLoaded("http://127.0.0.1:11434");
    expect(r.source).toBe("http");
    expect(r.loaded[0].vramBytes).toBe(5_000_000_000);
    expect(r.loaded[0].sizeBytes).toBe(8_000_000_000);
  });

  it("returns none on non-200", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
    })) as unknown as typeof fetch;
    const r = await collectOllamaLoaded("http://127.0.0.1:11434");
    expect(r.source).toBe("none");
    expect(r.http?.ok).toBe(false);
  });
});
