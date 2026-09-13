import { describe, expect, it, vi } from "vitest";
import { parseMtplxHealth } from "./mtplx-contention.js";
import { makeContentionProbe, resolveContentionConfig, runIdleGate, type GateParams } from "./contention-probe.js";

function health(active = 0, pending = 0) {
  return { ok: true, generation_mode: "mtp", active_requests: active + pending,
    foreground_active: active, scheduler: { mode: "ar_batch", active_requests: active + pending,
      ar_batch: { active, pending }, mtp_batch: {} },
    gpu_keepalive: { enabled: true, attentive: true }, requests_completed: 10, requests_cancelled: 2,
    model_path: "/private/model/path" };
}
function setup(body: unknown = health(), gpu = 0) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/health")
    ? Response.json(body) : new Response("", { status: 404 }));
  const cfg = resolveContentionConfig({ provider: "openai_compatible" });
  const probe = makeContentionProbe({ provider: "openai_compatible", baseUrl: "http://localhost:8000/v1",
    modelId: "arbitrary-name", apiKey: "test-only", cfg, fetchImpl: fetchImpl as typeof fetch,
    getGpu: async () => ({ available: true, devices: [{ index: 0, name: "test", memoryTotalMiB: 1, memoryUsedMiB: 0, utilizationPct: gpu }] }) });
  return { probe, fetchImpl, cfg };
}

describe("MTPLX contention REST adapter", () => {
  it("deduplicates overlapping counters and strips unapproved health fields", () => {
    expect(parseMtplxHealth(health(1))).toMatchObject({ outstanding: 1, pending: 0 });
    expect(parseMtplxHealth(health(1, 1))).toMatchObject({ outstanding: 2, pending: 1 });
    expect(parseMtplxHealth(health())).not.toHaveProperty("model_path");
  });
  it.each([{}, { ...health(), active_requests: undefined }, { ...health(), active_requests: -1 }, { ...health(), scheduler: null }])("missing or invalid counters are not idle", (body) => {
    expect(parseMtplxHealth(body)).toBeUndefined();
  });
  it("uses authentication and keeps GPU isolation even with idle keepalive", async () => {
    const { probe, fetchImpl } = setup(health(), 90);
    expect(await probe.sampleIdle()).toMatchObject({ active: true, reasons: ["gpu_util=90%"], diagnostics: { mtplx_status: "available", mtplx: { outstanding: 0, keepalive_attentive: true } } });
    const call = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith("/health"));
    expect(call).toBeDefined();
    // Inspect through the actual request mock rather than introducing real credentials.
    expect((fetchImpl.mock.calls as unknown[][]).find((c) => String(c[0]).endsWith("/health"))?.[1]).toMatchObject({ headers: { Authorization: "Bearer test-only" }, signal: expect.any(AbortSignal) });
  });
  it.each([[1, 0, false], [0, 1, false], [1, 1, true], [2, 0, true]] as const)("active=%i pending=%i distinguishes our request from concurrency", async (a, p, contended) => {
    const { probe } = setup(health(a, p));
    expect((await probe.sampleIdle()).active).toBe(true);
    expect((await probe.sampleInFlight({ loadedIds: [], expiresById: {} })).contended).toBe(contended);
  });
  it("never reuses idle after an authentication or transport failure", async () => {
    const { probe, fetchImpl } = setup();
    expect((await probe.sampleIdle()).diagnostics?.mtplx_status).toBe("available");
    fetchImpl.mockImplementation(async () => new Response("", { status: 401 }));
    expect((await probe.sampleIdle()).diagnostics).toMatchObject({ mtplx_status: "unavailable", mtplx: undefined });
    fetchImpl.mockImplementation(async () => { throw new Error("offline"); });
    expect((await probe.sampleIdle()).diagnostics?.mtplx_status).toBe("unavailable");
  });
  it("coalesces overlapping health probes", async () => {
    const { probe, fetchImpl } = setup();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    fetchImpl.mockImplementation(async (url) => {
      if (!String(url).endsWith("/health")) return new Response("", { status: 404 });
      await hold;
      return Response.json(health());
    });
    const a = probe.sampleIdle(), b = probe.sampleInFlight({ loadedIds: [], expiresById: {} });
    release();
    await Promise.all([a, b]);
    expect(fetchImpl.mock.calls.filter((c) => String(c[0]).endsWith("/health"))).toHaveLength(1);
  });
  it("bounds history and links the previous timeout through final abort", async () => {
    const { probe, cfg } = setup(health(1));
    let now = 0;
    const waitAccum: GateParams["waitAccum"] = { total: 0, precedingFailure: { code: "request_timeout", scenario_id: "code_sort_js", api_route: "messages" } };
    const gate = runIdleGate(probe, cfg, { now: () => now, sleep: async (ms) => { now += ms; } }, { phase: "between_iterations", waitAccum });
    const events = [];
    let result;
    for (;;) { const next = await gate.next(); if (next.done) { result = next.value; break; } events.push(next.value); }
    expect(result?.code).toBe("between_iteration_wait_timeout");
    expect(waitAccum.observations).toHaveLength(20);
    expect(waitAccum.observations?.at(-1)).toMatchObject({ preceding_failure: { code: "request_timeout" }, mtplx: { outstanding: 1 } });
    expect(events[0]).toHaveProperty("observation");
  });
});
