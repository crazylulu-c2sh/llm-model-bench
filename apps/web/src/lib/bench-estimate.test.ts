import { describe, expect, it } from "vitest";
import type { BenchRunDetailResponse, LatestByModelResponse } from "../api-types";
import { blendUnitMs, buildBaseModelTimeIndex, buildScenarioTimeIndex, estimateModelMs } from "./bench-estimate";

function run(overrides: Partial<BenchRunDetailResponse> = {}): BenchRunDetailResponse {
  return {
    meta: {
      run_id: "r1",
      base_url: "http://localhost:1234",
      provider: "lm_studio",
      model_id: "m",
      created_at: "2026-01-01T00:00:00.000Z",
      warmup_runs: 1,
      measured_runs: 3,
    },
    scenarios: [],
    ...overrides,
  };
}

function scenarioRun(totalMs: number) {
  return { ttft_ms: 100, total_ms: totalMs, output_text: "hi", stream_completed: true };
}

describe("buildScenarioTimeIndex", () => {
  it("averages total_ms per model/scenario/api and applies warmup+measured multiplier", () => {
    const latest: LatestByModelResponse = {
      base_url: "http://localhost:1234",
      items: [
        {
          model_id: "qwen3-8b@q4_k_m",
          run: run({
            scenarios: [
              {
                id: "chat_hello",
                api_route: "chat_completions",
                runs: [scenarioRun(1000), scenarioRun(2000)],
                prompt_preview: null,
                prompt_system_preview: null,
              },
            ],
          }),
        },
      ],
    };
    const idx = buildScenarioTimeIndex(latest);
    const stat = idx.get("qwen3-8b@q4_k_m::chat_hello::chat_completions");
    expect(stat?.avgMs).toBe(1500);
    expect(stat?.iterMultiplier).toBe(4); // warmup_runs(1) + measured_runs(3)
  });

  it("ignores zero-duration failure rows and skips warmup for vision scenarios", () => {
    const latest: LatestByModelResponse = {
      base_url: "http://localhost:1234",
      items: [
        {
          model_id: "m1",
          run: run({
            scenarios: [
              {
                id: "vision_table_ocr_a",
                api_route: "chat_completions",
                runs: [scenarioRun(0), scenarioRun(3000), scenarioRun(5000)],
                prompt_preview: null,
                prompt_system_preview: null,
              },
            ],
          }),
        },
      ],
    };
    const idx = buildScenarioTimeIndex(latest);
    const stat = idx.get("m1::vision_table_ocr_a::chat_completions");
    expect(stat?.avgMs).toBe(4000);
    expect(stat?.iterMultiplier).toBe(3); // measured_runs only, warmup skipped for vision
  });

  it("returns an empty index for null input", () => {
    expect(buildScenarioTimeIndex(null).size).toBe(0);
  });
});

describe("buildBaseModelTimeIndex", () => {
  it("groups different quantizations of the same base model and records source ids", () => {
    const latest: LatestByModelResponse = {
      base_url: "http://localhost:1234",
      items: [
        {
          model_id: "qwen3-8b@q4_k_m",
          run: run({
            scenarios: [
              {
                id: "chat_hello",
                api_route: "chat_completions",
                runs: [scenarioRun(1000)],
                prompt_preview: null,
                prompt_system_preview: null,
              },
            ],
          }),
        },
        {
          model_id: "qwen3-8b@q8_0",
          run: run({
            scenarios: [
              {
                id: "chat_hello",
                api_route: "chat_completions",
                runs: [scenarioRun(3000)],
                prompt_preview: null,
                prompt_system_preview: null,
              },
            ],
          }),
        },
      ],
    };
    const idx = buildBaseModelTimeIndex(latest);
    const stat = idx.get("qwen3-8b::chat_hello::chat_completions");
    expect(stat?.avgMs).toBe(2000); // (1000 + 3000) / 2
    expect(stat?.sourceModelIds.sort()).toEqual(["qwen3-8b@q4_k_m", "qwen3-8b@q8_0"]);
  });
});

describe("estimateModelMs", () => {
  it("returns null when neither exact nor base-model history exists", () => {
    const exact = buildScenarioTimeIndex(null);
    const base = buildBaseModelTimeIndex(null);
    expect(estimateModelMs("never-benched-model", ["chat_hello"], ["chat_completions"], exact, base)).toBeNull();
  });

  it("prefers exact model_id match over the quant fallback", () => {
    const latest: LatestByModelResponse = {
      base_url: "http://localhost:1234",
      items: [
        {
          model_id: "qwen3-8b@q4_k_m",
          run: run({
            scenarios: [
              {
                id: "chat_hello",
                api_route: "chat_completions",
                runs: [scenarioRun(1000)],
                prompt_preview: null,
                prompt_system_preview: null,
              },
            ],
          }),
        },
      ],
    };
    const exact = buildScenarioTimeIndex(latest);
    const base = buildBaseModelTimeIndex(latest);
    const est = estimateModelMs("qwen3-8b@q4_k_m", ["chat_hello"], ["chat_completions"], exact, base);
    expect(est?.usedFallbackFor).toEqual([]);
    expect(est?.covered).toBe(1);
    expect(est?.ms).toBe(1000 * 4); // warmup(1)+measured(3)
  });

  it("falls back to a sibling quantization when the exact model_id has no history", () => {
    const latest: LatestByModelResponse = {
      base_url: "http://localhost:1234",
      items: [
        {
          model_id: "qwen3-8b@q8_0",
          run: run({
            scenarios: [
              {
                id: "chat_hello",
                api_route: "chat_completions",
                runs: [scenarioRun(1000)],
                prompt_preview: null,
                prompt_system_preview: null,
              },
            ],
          }),
        },
      ],
    };
    const exact = buildScenarioTimeIndex(latest);
    const base = buildBaseModelTimeIndex(latest);
    const est = estimateModelMs("qwen3-8b@q4_k_m", ["chat_hello"], ["chat_completions"], exact, base);
    expect(est).not.toBeNull();
    expect(est?.usedFallbackFor).toEqual([{ scenarioId: "chat_hello", apiRoute: "chat_completions", quant: "q8_0" }]);
  });

  it("fills uncovered scenario/api units using the mean of covered units", () => {
    const latest: LatestByModelResponse = {
      base_url: "http://localhost:1234",
      items: [
        {
          model_id: "m1",
          run: run({
            scenarios: [
              {
                id: "chat_hello",
                api_route: "chat_completions",
                runs: [scenarioRun(1000)],
                prompt_preview: null,
                prompt_system_preview: null,
              },
            ],
          }),
        },
      ],
    };
    const exact = buildScenarioTimeIndex(latest);
    const base = buildBaseModelTimeIndex(latest);
    const est = estimateModelMs("m1", ["chat_hello", "chat_ping"], ["chat_completions"], exact, base);
    expect(est?.covered).toBe(1);
    expect(est?.total).toBe(2);
    // covered unit contributes 1000*4=4000; uncovered unit filled with the same mean (4000) -> total 8000
    expect(est?.ms).toBe(8000);
  });
});

describe("blendUnitMs", () => {
  it("returns null when there is neither a historical baseline nor any live observation", () => {
    expect(blendUnitMs(null, 0, 0)).toBeNull();
  });

  it("returns the historical baseline untouched before any live iteration completes", () => {
    expect(blendUnitMs(1000, 0, 0)).toBe(1000);
  });

  it("falls back to the plain live average when there is no historical baseline", () => {
    expect(blendUnitMs(null, 900, 3)).toBe(300);
  });

  it("blends historical and live values weighted by k, converging toward live as samples grow", () => {
    // k=3: (1000*3 + 2000*1) / (3+1) = 1250
    expect(blendUnitMs(1000, 2000, 1, 3)).toBe(1250);
    // more live samples pull the blend further from the historical prior
    expect(blendUnitMs(1000, 2000 * 3, 3, 3)).toBe(1500);
  });
});
