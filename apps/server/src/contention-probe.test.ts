import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GpuSnapshot } from "@llm-bench/shared";
import {
  type Clock,
  type ContentionProbe,
  type InFlightBaseline,
  defaultClock,
  makeContentionProbe,
  parseLmsPsActivity,
  parsePrometheusRunningWaiting,
  resolveContentionConfig,
  runIdleGate,
  startInflightMonitor,
} from "./contention-probe";
import { _resetLmsCliCacheForTest, LMS_ENV_FLAG } from "./lms-cli";

const baseCfg = resolveContentionConfig({ provider: "openai_compatible" });

function gpu(util: number | null): GpuSnapshot {
  if (util == null) return { available: false, devices: [], error: "no nvidia-smi" };
  return {
    available: true,
    devices: [{ index: 0, name: "gpu0", memoryTotalMiB: 1, memoryUsedMiB: 0, utilizationPct: util }],
  };
}

function okText(text: string): Response {
  return { ok: true, status: 200, text: async () => text, json: async () => ({}) } as unknown as Response;
}
function notFound(): Response {
  return { ok: false, status: 404, text: async () => "", statusText: "Not Found" } as unknown as Response;
}

describe("parsePrometheusRunningWaiting", () => {
  it("parses vLLM gauges", () => {
    const t = `# HELP\nvllm:num_requests_running 2.0\nvllm:num_requests_waiting{model="x"} 1\n`;
    expect(parsePrometheusRunningWaiting(t)).toEqual({ running: 2, waiting: 1 });
  });
  it("parses llama.cpp and TGI gauges", () => {
    expect(parsePrometheusRunningWaiting("llamacpp:requests_processing 1\nllamacpp:requests_deferred 0\n")).toEqual({
      running: 1,
      waiting: 0,
    });
    expect(parsePrometheusRunningWaiting("tgi_batch_current_size 3\ntgi_queue_size 4\n")).toEqual({
      running: 3,
      waiting: 4,
    });
  });
  it("returns null when no known gauge present", () => {
    expect(parsePrometheusRunningWaiting("# only comments\nfoo_bar 5\n")).toBeNull();
    expect(parsePrometheusRunningWaiting("")).toBeNull();
  });
});

describe("parseLmsPsActivity", () => {
  it("extracts generating set and queued counts (baseKey-normalized)", () => {
    const json = JSON.stringify([
      { identifier: "qwen2.5-7b-instruct:2", isGenerating: true, numQueuedRequests: 1 },
      { identifier: "gemma-2-9b", generationStatus: "idle", queued: 0 },
    ]);
    const a = parseLmsPsActivity(json);
    expect(a.generating.has("qwen2.5-7b-instruct")).toBe(true);
    expect(a.generating.has("gemma-2-9b")).toBe(false);
    expect(a.queuedByKey.get("qwen2.5-7b-instruct")).toBe(1);
  });
  it("tolerates {models:[...]} wrapper and bad input", () => {
    expect(parseLmsPsActivity('{"models":[{"key":"m","status":"generating"}]}').generating.has("m")).toBe(true);
    expect(parseLmsPsActivity("not json").generating.size).toBe(0);
    expect(parseLmsPsActivity("").generating.size).toBe(0);
  });
});

describe("resolveContentionConfig", () => {
  it("clamps and applies defaults", () => {
    const c = resolveContentionConfig({
      provider: "ollama",
      contentionPollIntervalMs: 10,
      contentionMaxRetriesPerIteration: 99,
      contentionGpuUtilThresholdPct: 0,
    });
    expect(c.pollIntervalMs).toBe(250);
    expect(c.maxRetriesPerIteration).toBe(5);
    expect(c.gpuUtilThresholdPct).toBe(1);
    expect(c.enabled).toBe(true);
  });
  it("disables for manual provider", () => {
    expect(resolveContentionConfig({ provider: "manual" }).enabled).toBe(false);
  });
});

describe("sampleIdle (openai_compatible /metrics + GPU)", () => {
  it("GPU above threshold marks active (loopback target so GPU usable)", async () => {
    const probe = makeContentionProbe({
      provider: "openai_compatible",
      baseUrl: "http://127.0.0.1:8000/v1",
      modelId: "m",
      cfg: baseCfg,
      fetchImpl: vi.fn(async () => notFound()) as unknown as typeof fetch, // /metrics 404 → drop
      getGpu: async () => gpu(90),
    });
    const s = await probe.sampleIdle();
    expect(s.gpuSignalAvailable).toBe(true);
    expect(s.active).toBe(true);
    expect(s.hasActiveSignal).toBe(true);
  });

  it("metrics running>=1 while idle marks active even without GPU", async () => {
    const probe = makeContentionProbe({
      provider: "openai_compatible",
      baseUrl: "http://remote-host:8000/v1",
      modelId: "m",
      cfg: baseCfg,
      fetchImpl: vi.fn(async () => okText("vllm:num_requests_running 1\n")) as unknown as typeof fetch,
      getGpu: async () => gpu(null), // also remote host → GPU not usable anyway
    });
    const s = await probe.sampleIdle();
    expect(s.active).toBe(true);
    expect(s.hasActiveSignal).toBe(true);
    expect(s.gpuSignalAvailable).toBe(false);
  });

  it("no signal available → not active, reason no_contention_signal_available", async () => {
    const probe = makeContentionProbe({
      provider: "openai_compatible",
      baseUrl: "http://remote:8000/v1",
      modelId: "m",
      cfg: baseCfg,
      fetchImpl: vi.fn(async () => notFound()) as unknown as typeof fetch,
      getGpu: async () => gpu(null),
    });
    const s = await probe.sampleIdle();
    expect(s.active).toBe(false);
    expect(s.hasActiveSignal).toBe(false);
    expect(s.reasons).toContain("no_contention_signal_available");
  });
});

describe("sampleInFlight (self-contention guard)", () => {
  const baseline: InFlightBaseline = { loadedIds: [], expiresById: {} };

  it("does NOT fire when only our single request runs (running=1)", async () => {
    const probe = makeContentionProbe({
      provider: "openai_compatible",
      baseUrl: "http://h:8000/v1",
      modelId: "m",
      cfg: baseCfg,
      fetchImpl: vi.fn(async () => okText("vllm:num_requests_running 1\nvllm:num_requests_waiting 0\n")) as unknown as typeof fetch,
    });
    const s = await probe.sampleInFlight(baseline);
    expect(s.contended).toBe(false);
  });

  it("fires on same-model concurrent request (running=2)", async () => {
    const probe = makeContentionProbe({
      provider: "openai_compatible",
      baseUrl: "http://h:8000/v1",
      modelId: "m",
      cfg: baseCfg,
      fetchImpl: vi.fn(async () => okText("vllm:num_requests_running 2\n")) as unknown as typeof fetch,
    });
    const s = await probe.sampleInFlight(baseline);
    expect(s.contended).toBe(true);
    expect(s.reasons.join(" ")).toMatch(/server_running=2/);
  });

  it("fires on Ollama loaded-id churn (new foreign model)", async () => {
    const fetchImpl = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ models: [{ model: "other:7b", name: "other:7b", size_vram: 1, size: 2 }] }),
      }) as unknown as Response,
    ) as unknown as typeof fetch;
    const probe = makeContentionProbe({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      modelId: "ours:7b",
      cfg: baseCfg,
      fetchImpl,
    });
    const s = await probe.sampleInFlight({ loadedIds: ["ours:7b"], expiresById: {} });
    expect(s.contended).toBe(true);
    expect(s.reasons.join(" ")).toMatch(/new_model_loaded=other:7b/);
  });
});

describe("sampleInFlight LM Studio lms ps", () => {
  beforeEach(() => {
    process.env[LMS_ENV_FLAG] = "1";
    _resetLmsCliCacheForTest();
  });
  afterEach(() => {
    delete process.env[LMS_ENV_FLAG];
    _resetLmsCliCacheForTest();
  });

  it("fires on same-model queued>0 via lms ps --json (loopback target)", async () => {
    // LM Studio /api/v1/models returns empty loaded list; lms ps reports queued on our model.
    const fetchImpl = vi.fn(async () =>
      ({ ok: true, status: 200, text: async () => "", json: async () => ({ data: [] }) }) as unknown as Response,
    ) as unknown as typeof fetch;
    const probe = makeContentionProbe({
      provider: "lm_studio",
      baseUrl: "http://127.0.0.1:1234",
      modelId: "qwen:2",
      cfg: baseCfg,
      fetchImpl,
      runLmsPs: async () => ({ ok: true, stdout: JSON.stringify([{ identifier: "qwen:2", numQueuedRequests: 1 }]) }),
    });
    const s = await probe.sampleInFlight({ loadedIds: [], expiresById: {} });
    expect(s.contended).toBe(true);
    expect(s.reasons.join(" ")).toMatch(/lms_foreign_generating=.* queued=1/);
  });
});

// ── runIdleGate with a fake probe + fake clock ──────────────────────────────

function fakeClock(): Clock & { ticks: number } {
  const c = {
    ticks: 0,
    now() {
      return c.ticks;
    },
    async sleep(ms: number) {
      c.ticks += ms;
    },
  };
  return c as Clock & { ticks: number };
}

function scriptedProbe(idleSeq: boolean[]): ContentionProbe {
  let i = 0;
  return {
    async sampleIdle() {
      const active = i < idleSeq.length ? !idleSeq[i] : false;
      i++;
      return {
        active,
        reasons: active ? ["server_running=1 waiting=0"] : ["idle"],
        gpuUtilPct: null,
        gpuSignalAvailable: false,
        hasActiveSignal: true,
      };
    },
    async segmentBaseline() {
      return { loadedIds: [], expiresById: {} };
    },
    async sampleInFlight() {
      return { contended: false, reasons: [] };
    },
  };
}

async function drainGate(gen: AsyncGenerator<unknown, unknown>) {
  const events: unknown[] = [];
  let res: IteratorResult<unknown, unknown>;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    res = await gen.next();
    if (res.done) return { events, result: res.value as ReturnType<typeof Object> };
    events.push(res.value);
  }
}

describe("runIdleGate", () => {
  const cfg = resolveContentionConfig({ provider: "openai_compatible" });

  it("returns idle immediately with no events when first sample is idle", async () => {
    const gen = runIdleGate(scriptedProbe([true]), cfg, fakeClock(), {
      phase: "pre_bench",
      waitAccum: { total: 0 },
    });
    const { events, result } = await drainGate(gen);
    expect(events.length).toBe(0);
    expect((result as { idle: boolean }).idle).toBe(true);
    expect((result as { waitedMs: number }).waitedMs).toBe(0);
  });

  it("waits while busy then resumes after consecutive idle", async () => {
    // busy, busy, idle, idle  (requiredConsecutiveIdle default 2)
    const gen = runIdleGate(scriptedProbe([false, false, true, true]), cfg, fakeClock(), {
      phase: "between_iterations",
      waitAccum: { total: 0 },
    });
    const { events, result } = await drainGate(gen);
    const types = (events as { type: string }[]).map((e) => e.type);
    expect(types).toContain("contention_waiting");
    expect(types).toContain("contention_resumed");
    expect((result as { idle: boolean }).idle).toBe(true);
  });

  it("fails with between_iteration_wait_timeout when never idle", async () => {
    const tightCfg = resolveContentionConfig({
      provider: "openai_compatible",
      contentionBetweenIterationTimeoutMs: 2000,
      contentionPollIntervalMs: 1000,
    });
    const gen = runIdleGate(scriptedProbe(new Array(50).fill(false)), tightCfg, fakeClock(), {
      phase: "between_iterations",
      waitAccum: { total: 0 },
    });
    const { result } = await drainGate(gen);
    expect((result as { idle: boolean }).idle).toBe(false);
    expect((result as { code?: string }).code).toBe("between_iteration_wait_timeout");
  });

  it("fails with total_wait_budget_exceeded across cumulative wait", async () => {
    const cfg2 = resolveContentionConfig({
      provider: "openai_compatible",
      contentionTotalWaitBudgetMs: 1500,
      contentionPollIntervalMs: 1000,
      contentionBetweenIterationTimeoutMs: 60_000,
    });
    const accum = { total: 1000 }; // already near budget from prior waits
    const gen = runIdleGate(scriptedProbe(new Array(50).fill(false)), cfg2, fakeClock(), {
      phase: "between_iterations",
      waitAccum: accum,
    });
    const { result } = await drainGate(gen);
    expect((result as { code?: string }).code).toBe("total_wait_budget_exceeded");
  });
});

describe("startInflightMonitor teardown (lost-detection race)", () => {
  function idleProbe(sampleInFlight: ContentionProbe["sampleInFlight"]): ContentionProbe {
    return {
      async sampleIdle() {
        return { active: false, reasons: ["idle"], gpuUtilPct: null, gpuSignalAvailable: false, hasActiveSignal: true };
      },
      async segmentBaseline() {
        return { loadedIds: [], expiresById: {} };
      },
      sampleInFlight,
    };
  }

  it("awaits an in-flight sample on teardown and honors a late contended result", async () => {
    let resolveSample: (v: { contended: boolean; reasons: string[] }) => void = () => {};
    const probe = idleProbe(() => new Promise((res) => {
      resolveSample = res;
    }));
    // abortable real-ish sleep (resolves on next macrotask) so the monitor parks at sampleInFlight.
    const clock: Clock = {
      now: () => 0,
      sleep: (_ms, signal) =>
        new Promise<void>((res, rej) => {
          if (signal?.aborted) return rej(new DOMException("Aborted", "AbortError"));
          const t = setTimeout(res, 0);
          signal?.addEventListener("abort", () => {
            clearTimeout(t);
            rej(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        }),
    };
    let detected: string[] | null = null;
    const stop = startInflightMonitor({
      probe,
      baseline: { loadedIds: [], expiresById: {} },
      cfg: baseCfg,
      clock,
      onDetect: (r) => {
        detected = r;
      },
    });
    await new Promise((r) => setTimeout(r, 5)); // let it park at sampleInFlight
    const stopP = stop();
    // resolve the in-flight sample as contended AFTER teardown was requested
    resolveSample({ contended: true, reasons: ["server_running=2"] });
    await stopP;
    expect(detected).toEqual(["server_running=2"]);
  });

  it("returns promptly when sleeping (no pending sample) without false detection", async () => {
    const probe = idleProbe(async () => ({ contended: false, reasons: [] }));
    let detected = false;
    const stop = startInflightMonitor({
      probe,
      baseline: { loadedIds: [], expiresById: {} },
      cfg: baseCfg, // pollIntervalMs 1000 → monitor is sleeping when we stop
      clock: defaultClock,
      onDetect: () => {
        detected = true;
      },
    });
    const t0 = Date.now();
    await stop(); // sleepCtrl.abort() must cut the 1s sleep short
    expect(Date.now() - t0).toBeLessThan(500);
    expect(detected).toBe(false);
  });
});
