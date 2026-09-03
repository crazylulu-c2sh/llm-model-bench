import { describe, expect, it } from "vitest";
import {
  BENCH_THROUGHPUT_MAX_TOKENS,
  BenchQueueModelStatusSchema,
  BenchQueueSnapshotSchema,
  benchProfileForModel,
  classifyModelOutcome,
  type BenchProfileIntent,
  type ModelRunOutcome,
} from "./bench-queue.js";

/**
 * 실제 `inferLlmProfileFamily` 정규식에 걸리는 id만 쓴다 — 가짜 id로 테스트하면 패밀리 게이트가
 * 전부 unknown으로 떨어져 "effort가 안 실린다"는 회귀를 통과시켜 버린다.
 */
const GPT_OSS = "openai/gpt-oss-20b";
const QWEN38 = "Qwen/Qwen3.8-27B";
const QWEN36 = "Qwen/Qwen3.6-30B-A3B";
const GEMMA4 = "google/gemma-4-12b-it-qat";
const UNKNOWN = "Qwen/Qwen3-8B";

describe("benchProfileForModel", () => {
  it("혼합 큐: gpt-oss와 Qwen3.8이 각자 다른 effort를 받는다", () => {
    // 이 PR의 핵심 회귀: 큐 하나에 두 패밀리가 섞여 있으면 effort 칸이 하나일 때 한쪽이 유실된다.
    const intent: BenchProfileIntent = {
      profileId: "auto",
      taskMode: "general",
      thinkingIntent: "on",
      reasoningEffort: "high",
      qwen38ReasoningEffort: "xhigh",
    };
    expect(benchProfileForModel(GPT_OSS, intent).reasoningEffort).toBe("high");
    expect(benchProfileForModel(QWEN38, intent).reasoningEffort).toBe("xhigh");
    // 두 칸 중 어느 것도 다른 패밀리로 새지 않는다.
    expect(benchProfileForModel(QWEN36, intent).reasoningEffort).toBeUndefined();
    expect(benchProfileForModel(GEMMA4, intent).reasoningEffort).toBeUndefined();
    expect(benchProfileForModel(UNKNOWN, intent).reasoningEffort).toBeUndefined();
  });

  it("profileId를 auto로 두면 modelId로 패밀리를 추론한다", () => {
    const r = benchProfileForModel(QWEN38, {
      profileId: "auto",
      qwen38ReasoningEffort: "medium",
      preserveThinking: true,
    });
    expect(r.reasoningEffort).toBe("medium");
    expect(r.preserveThinking).toBe(true);
    // profileId 자체는 손대지 않고 그대로 실어 보낸다(백엔드가 다시 해석한다).
    expect(r.profileId).toBe("auto");
  });

  it("profileId를 명시하면 modelId 추론을 무시한다", () => {
    // Qwen3.8 id인데 gpt_oss로 고정 → gpt-oss 칸의 effort가 쓰이고 preserveThinking은 죽는다.
    const asGptOss = benchProfileForModel(QWEN38, {
      profileId: "gpt_oss",
      reasoningEffort: "low",
      qwen38ReasoningEffort: "xhigh",
      preserveThinking: true,
    });
    expect(asGptOss.reasoningEffort).toBe("low");
    expect(asGptOss.preserveThinking).toBe(false);
    expect(asGptOss.profileId).toBe("gpt_oss");

    // 반대 방향: gemma id를 qwen38로 고정하면 qwen38 칸이 쓰인다.
    const asQwen38 = benchProfileForModel(GEMMA4, {
      profileId: "qwen38",
      reasoningEffort: "high",
      qwen38ReasoningEffort: "low",
      preserveThinking: true,
    });
    expect(asQwen38.reasoningEffort).toBe("low");
    expect(asQwen38.preserveThinking).toBe(true);
  });

  it("profileId가 아예 없으면 auto와 같게 추론한다", () => {
    const r = benchProfileForModel(GPT_OSS, { reasoningEffort: "minimal" });
    expect(r.reasoningEffort).toBe("minimal");
    expect(r.profileId).toBeUndefined();
  });

  it("preserveThinking은 qwen36·qwen38에서만 살아남는다", () => {
    const intent: BenchProfileIntent = { profileId: "auto", preserveThinking: true };
    expect(benchProfileForModel(QWEN36, intent).preserveThinking).toBe(true);
    expect(benchProfileForModel(QWEN38, intent).preserveThinking).toBe(true);
    for (const id of [GPT_OSS, GEMMA4, UNKNOWN]) {
      expect(benchProfileForModel(id, intent).preserveThinking).toBe(false);
    }
  });

  it("preserveThinking이 없으면 qwen 계열에서도 false다(undefined가 아니다)", () => {
    const r = benchProfileForModel(QWEN38, { profileId: "auto" });
    expect(r.preserveThinking).toBe(false);
  });

  it("성능 측정 모드는 사고를 끄고 출력 한도를 고정하며 preset·preserveThinking을 없앤다", () => {
    const r = benchProfileForModel(QWEN38, {
      profileId: "auto",
      thinkingIntent: "on",
      preserveThinking: true,
      presetOverride: "thinking_general",
      profileMaxTokens: 4096,
      qwen38ReasoningEffort: "xhigh",
      benchmarkThroughputMode: true,
    });
    expect(r.thinkingIntent).toBe("off");
    expect(r.profileMaxTokens).toBe(BENCH_THROUGHPUT_MAX_TOKENS);
    expect(BENCH_THROUGHPUT_MAX_TOKENS).toBe(512);
    expect(r.presetOverride).toBeUndefined();
    expect(r.preserveThinking).toBe(false);
    // effort는 성능 모드에서도 그대로 실린다 — 사고 off 클램프는 resolveBenchProfile의 몫이다.
    expect(r.reasoningEffort).toBe("xhigh");
  });

  it("성능 측정 모드가 꺼져 있으면 사용자가 넣은 한도·preset·thinking이 그대로 간다", () => {
    const r = benchProfileForModel(GEMMA4, {
      profileId: "auto",
      thinkingIntent: "on",
      presetOverride: "thinking_coding",
      profileMaxTokens: 4096,
      taskMode: "coding",
    });
    expect(r.thinkingIntent).toBe("on");
    expect(r.profileMaxTokens).toBe(4096);
    expect(r.presetOverride).toBe("thinking_coding");
    expect(r.taskMode).toBe("coding");
  });

  it.each([
    ["0", 0],
    ["음수", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("profileMaxTokens가 %s이면 무시한다", (_label, value) => {
    const r = benchProfileForModel(GEMMA4, { profileId: "auto", profileMaxTokens: value });
    expect(r.profileMaxTokens).toBeUndefined();
  });

  it("profileMaxTokens가 null이거나 없어도 무시한다", () => {
    expect(
      benchProfileForModel(GEMMA4, { profileId: "auto", profileMaxTokens: null }).profileMaxTokens,
    ).toBeUndefined();
    expect(benchProfileForModel(GEMMA4, { profileId: "auto" }).profileMaxTokens).toBeUndefined();
  });

  it("profileMaxTokens의 소수점은 버린다", () => {
    const r = benchProfileForModel(GEMMA4, { profileId: "auto", profileMaxTokens: 1024.9 });
    expect(r.profileMaxTokens).toBe(1024);
  });

  it("samplingOverrides/presetOverride의 null은 undefined로 정규화된다", () => {
    // 폼이 "선택 안 함"을 null로 들고 있어도 와이어에는 필드가 사라져야 한다 —
    // null이 그대로 나가면 서버 스키마가 거절하거나 프리셋을 null로 덮어쓴다.
    const r = benchProfileForModel(GEMMA4, {
      profileId: "auto",
      presetOverride: null,
      samplingOverrides: null,
      reasoningEffort: null,
      qwen38ReasoningEffort: null,
    });
    expect(r.presetOverride).toBeUndefined();
    expect(r.samplingOverrides).toBeUndefined();
    expect(r.reasoningEffort).toBeUndefined();
  });

  it("null effort는 패밀리가 맞아도 undefined가 된다", () => {
    expect(
      benchProfileForModel(GPT_OSS, { profileId: "auto", reasoningEffort: null }).reasoningEffort,
    ).toBeUndefined();
    expect(
      benchProfileForModel(QWEN38, { profileId: "auto", qwen38ReasoningEffort: null })
        .reasoningEffort,
    ).toBeUndefined();
  });

  it("samplingOverrides 객체는 그대로 전달된다", () => {
    const overrides = { temperature: 0.3, top_p: 0.9 };
    const r = benchProfileForModel(GEMMA4, { profileId: "auto", samplingOverrides: overrides });
    expect(r.samplingOverrides).toEqual(overrides);
  });
});

describe("classifyModelOutcome", () => {
  const base: ModelRunOutcome = {
    httpFailed: false,
    threw: false,
    sawRunFinished: true,
    cancelled: false,
    skippedByPreflight: false,
    scenarioErrorCount: 0,
  };

  it("에러 없이 끝나면 done이다", () => {
    expect(classifyModelOutcome(base)).toBe("done");
  });

  it("시나리오 에러가 있으면 done-with-errors다", () => {
    expect(classifyModelOutcome({ ...base, scenarioErrorCount: 1 })).toBe("done-with-errors");
  });

  it("취소가 다른 모든 신호보다 우선한다", () => {
    // 긴급 정지도 run_finished를 내보내므로 순서가 뒤집히면 중지된 모델이 done으로 찍힌다.
    expect(classifyModelOutcome({ ...base, cancelled: true })).toBe("cancelled");
    expect(
      classifyModelOutcome({
        ...base,
        cancelled: true,
        httpFailed: true,
        threw: true,
        skippedByPreflight: true,
        sawRunFinished: false,
        scenarioErrorCount: 3,
      }),
    ).toBe("cancelled");
  });

  it("preflight로 건너뛴 모델은 failed다", () => {
    // run_started조차 없어 결과가 0건이므로 done 계열로 세면 안 된다.
    expect(classifyModelOutcome({ ...base, skippedByPreflight: true, sawRunFinished: false })).toBe(
      "failed",
    );
    expect(classifyModelOutcome({ ...base, skippedByPreflight: true })).toBe("failed");
  });

  it("run_finished를 못 봤으면 failed다", () => {
    // 스트림이 중간에 끊긴 경우 — 에러 0건이라고 done으로 세면 미완성 런이 완료로 남는다.
    expect(classifyModelOutcome({ ...base, sawRunFinished: false })).toBe("failed");
    expect(classifyModelOutcome({ ...base, sawRunFinished: false, scenarioErrorCount: 2 })).toBe(
      "failed",
    );
  });

  it("httpFailed·threw는 failed다", () => {
    expect(classifyModelOutcome({ ...base, httpFailed: true })).toBe("failed");
    expect(classifyModelOutcome({ ...base, threw: true })).toBe("failed");
  });
});

describe("BenchQueue 스키마", () => {
  it("BenchQueueModelStatusSchema에 UI 파생 상태 paused는 없다", () => {
    // 서버는 큐 단위 paused 플래그만 내보낸다 — 모델 상태에 paused를 넣으면 재개 시 복구할 원래
    // 상태를 잃는다.
    expect(BenchQueueModelStatusSchema.options).toEqual([
      "pending",
      "running",
      "done",
      "done-with-errors",
      "failed",
      "cancelled",
    ]);
    expect(BenchQueueModelStatusSchema.safeParse("paused").success).toBe(false);
  });

  it("BenchQueueSnapshotSchema가 실제 스냅샷 객체를 통과시킨다", () => {
    const snapshot = {
      queue_id: "q_01",
      base_url: "http://10.10.4.50:1234",
      provider: "lm_studio",
      status: "running",
      created_at: 1_700_000_000_000,
      finished_at: null,
      index: 1,
      paused: false,
      current_run_id: "run_02",
      models: [
        {
          model_id: GPT_OSS,
          status: "done-with-errors",
          run_id: "run_01",
          started_at: 1_700_000_000_100,
          finished_at: 1_700_000_060_000,
          error_count: 2,
        },
        {
          model_id: QWEN38,
          status: "running",
          run_id: "run_02",
          started_at: 1_700_000_060_100,
          finished_at: null,
          error_count: 0,
        },
        {
          model_id: GEMMA4,
          status: "pending",
          // run_started 전에 실패하면 bench_runs 행이 없어 run_id가 null로 남는다.
          run_id: null,
          started_at: null,
          finished_at: null,
          error_count: 0,
        },
      ],
      plan: {
        scenario_ids: ["text_basic", "vision_basic"],
        api_routes: ["chat_completions", "messages"],
        warmup_runs: 1,
        measured_runs: 3,
      },
    };
    const parsed = BenchQueueSnapshotSchema.parse(snapshot);
    expect(parsed.models).toHaveLength(3);
    expect(parsed.models[2]?.run_id).toBeNull();
    expect(parsed.plan.measured_runs).toBe(3);
  });

  it("error_count는 음수 정수를 거절한다", () => {
    const model = {
      model_id: GPT_OSS,
      status: "done",
      run_id: "run_01",
      started_at: null,
      finished_at: null,
      error_count: -1,
    };
    expect(BenchQueueSnapshotSchema.shape.models.element.safeParse(model).success).toBe(false);
  });
});
