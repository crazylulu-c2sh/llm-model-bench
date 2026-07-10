import type { DetectResult, SystemSnapshot } from "@llm-bench/shared";
import { describe, expect, it } from "vitest";
import { preflightMemoryFit } from "./memory-preflight.js";
import type { FetchLike } from "./detect.js";

const GB = 1024 ** 3;
const BASE = "http://127.0.0.1:1234";

function detectWith(models: DetectResult["models"]): DetectResult {
  return {
    provider: "lm_studio",
    baseUrl: BASE,
    models,
    steps: [],
    capabilities: { openaiChat: true, anthropicMessages: false },
  };
}

function sys(freeGb: number): () => SystemSnapshot {
  return () => ({
    ts: "2026-07-10T00:00:00.000Z",
    totalMemBytes: 64 * GB,
    freeMemBytes: freeGb * GB,
    loadavg: [0, 0, 0],
    cpuCount: 8,
    platform: "linux",
  });
}

/** LM Studio `GET /api/v1/models` 응답을 흉내내는 fetchImpl. */
function listFetch(models: unknown[]): FetchLike {
  return (async (input: unknown) => {
    const url = String(input);
    if (url.endsWith("/api/v1/models")) {
      return new Response(JSON.stringify({ models }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("nf", { status: 404 });
  }) as unknown as FetchLike;
}

describe("preflightMemoryFit", () => {
  it("fits → proceed (candidate small, plenty free)", async () => {
    const fit = await preflightMemoryFit({
      base: BASE,
      modelId: "small",
      detect: detectWith([{ id: "small" }]),
      fetchImpl: listFetch([{ key: "small", size_bytes: 1 * GB, loaded_instances: [] }]),
      systemInfoImpl: sys(8),
    });
    expect(fit.action).toBe("proceed");
    expect(fit.event.will_fit).toBe(true);
    expect(fit.event.size_source).toBe("list");
    expect(fit.event.required_bytes).toBe(1 * GB);
  });

  it("skip → won't-fit reason when fitPolicy=skip", async () => {
    const fit = await preflightMemoryFit({
      base: BASE,
      modelId: "cand",
      fitPolicy: "skip",
      detect: detectWith([{ id: "cand" }]),
      fetchImpl: listFetch([{ key: "cand", size_bytes: 26 * GB, loaded_instances: [] }]),
      systemInfoImpl: sys(14),
    });
    expect(fit.action).toBe("skip");
    expect(fit.event.will_fit).toBe(false);
    expect(fit.event.reason).toContain("won't fit");
    expect(fit.event.reason).toContain("free");
  });

  it("unload_other_models → returns resident instances to evict when they free enough", async () => {
    const fit = await preflightMemoryFit({
      base: BASE,
      modelId: "cand",
      fitPolicy: "unload_other_models",
      detect: detectWith([{ id: "cand" }]),
      fetchImpl: listFetch([
        { key: "cand", size_bytes: 26 * GB, loaded_instances: [] },
        { key: "big", size_bytes: 40 * GB, loaded_instances: [{ id: "big:1", ram_usage: 40 * GB }] },
      ]),
      systemInfoImpl: sys(14),
    });
    expect(fit.action).toBe("unload_other_models");
    expect(fit.residentInstances.map((r) => r.modelKey)).toContain("big");
    expect(fit.event.resident_ram_bytes).toBe(40 * GB);
  });

  it("skip with (언로드해도 부족) when unload can't free enough", async () => {
    const fit = await preflightMemoryFit({
      base: BASE,
      modelId: "huge",
      fitPolicy: "unload_other_models",
      detect: detectWith([{ id: "huge" }]),
      fetchImpl: listFetch([
        { key: "huge", size_bytes: 50 * GB, loaded_instances: [] },
        { key: "tiny", size_bytes: 4 * GB, loaded_instances: [{ id: "tiny:1", ram_usage: 4 * GB }] },
      ]),
      systemInfoImpl: sys(8),
    });
    expect(fit.action).toBe("skip");
    expect(fit.event.reason).toContain("언로드해도 부족");
  });

  it("unknown candidate size → proceed (never blocks on missing data)", async () => {
    const fit = await preflightMemoryFit({
      base: BASE,
      modelId: "mystery",
      fitPolicy: "skip",
      detect: detectWith([{ id: "mystery" }]), // no size_bytes anywhere
      fetchImpl: listFetch([{ key: "mystery", loaded_instances: [] }]),
      systemInfoImpl: sys(1),
    });
    expect(fit.action).toBe("proceed");
    expect(fit.event.size_source).toBe("unknown");
    expect(fit.event.required_bytes).toBeNull();
  });

  it("falls back to detect size_bytes when list lacks it", async () => {
    const fit = await preflightMemoryFit({
      base: BASE,
      modelId: "cand",
      detect: detectWith([{ id: "cand", size_bytes: 1 * GB }]),
      fetchImpl: listFetch([{ key: "cand", loaded_instances: [] }]),
      systemInfoImpl: sys(8),
    });
    expect(fit.event.size_source).toBe("detect");
    expect(fit.action).toBe("proceed");
  });

  it("no fitPolicy → still proceeds and logs prediction even when it won't fit", async () => {
    const fit = await preflightMemoryFit({
      base: BASE,
      modelId: "cand",
      detect: detectWith([{ id: "cand" }]),
      fetchImpl: listFetch([{ key: "cand", size_bytes: 26 * GB, loaded_instances: [] }]),
      systemInfoImpl: sys(14),
    });
    // 정책 미지정: 예측(will_fit=false)은 기록하되 막지 않는다.
    expect(fit.action).toBe("proceed");
    expect(fit.event.will_fit).toBe(false);
  });
});
