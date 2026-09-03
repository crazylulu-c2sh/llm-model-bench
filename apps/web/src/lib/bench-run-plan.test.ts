import type { BenchQueueModelStatus, BenchQueueSnapshot } from "@llm-bench/shared";
import { describe, expect, test } from "vitest";
import { scenarioRowKey } from "../components/chart-types";
import {
  hydrateQueueStatus,
  mergeByRowKey,
  mergePlanWithRunMeta,
  planFromForm,
  planFromQueueSnapshot,
  planPendingUnits,
  planTotals,
  resolveBenchOutcomeToast,
  resolvePlanView,
  shouldRestoreFinishedQueue,
  type BenchPlanView,
  type BenchRunPlan,
} from "./bench-run-plan";

const GPT_OSS = "openai/gpt-oss-20b";
const QWEN38 = "Qwen/Qwen3.8-27B";
const GEMMA4 = "google/gemma-4-12b-it-qat";

type SnapshotModel = BenchQueueSnapshot["models"][number];

const queueModel = (
  id: string,
  status: BenchQueueModelStatus = "pending",
  over: Partial<SnapshotModel> = {},
): SnapshotModel => ({
  model_id: id,
  status,
  run_id: null,
  started_at: null,
  finished_at: null,
  error_count: 0,
  ...over,
});

const snapshot = (over: Partial<BenchQueueSnapshot> = {}): BenchQueueSnapshot => ({
  queue_id: "q_01",
  base_url: "http://10.10.4.50:1234",
  provider: "lm_studio",
  status: "running",
  created_at: 1_700_000_000_000,
  finished_at: null,
  index: 0,
  paused: false,
  current_run_id: null,
  models: [queueModel(GPT_OSS)],
  plan: {
    scenario_ids: ["text_basic", "vision_basic"],
    api_routes: ["chat_completions"],
    warmup_runs: 1,
    measured_runs: 3,
  },
  ...over,
});

const plan = (over: Partial<BenchRunPlan> = {}): BenchRunPlan => ({
  queueId: "q_01",
  modelIds: [GPT_OSS, QWEN38],
  index: 0,
  scenarioIds: ["text_basic"],
  apiRoutes: ["chat_completions"],
  warmupRuns: 1,
  measuredRuns: 3,
  done: [],
  statusById: { [GPT_OSS]: "running", [QWEN38]: "pending" },
  source: "server",
  ...over,
});

const view = (over: Partial<BenchPlanView> = {}): BenchPlanView => ({
  modelIds: [GPT_OSS],
  scenarioIds: ["text_basic"],
  apiRoutes: ["chat_completions"],
  hasPlan: true,
  ...over,
});

describe("planFromQueueSnapshot — 서버 스냅샷이 단일 소스", () => {
  test("정상 스냅샷을 계획으로 옮긴다", () => {
    const out = planFromQueueSnapshot(
      snapshot({
        index: 1,
        current_run_id: "run_02",
        models: [
          queueModel(GPT_OSS, "done", { run_id: "run_01" }),
          queueModel(QWEN38, "running", { run_id: "run_02" }),
          queueModel(GEMMA4, "pending"),
        ],
        plan: {
          scenario_ids: ["text_basic", "vision_basic"],
          api_routes: ["chat_completions", "messages"],
          warmup_runs: 2,
          measured_runs: 5,
        },
      }),
    );
    expect(out).toEqual({
      queueId: "q_01",
      modelIds: [GPT_OSS, QWEN38, GEMMA4],
      index: 1,
      scenarioIds: ["text_basic", "vision_basic"],
      apiRoutes: ["chat_completions", "messages"],
      warmupRuns: 2,
      measuredRuns: 5,
      done: [{ modelId: GPT_OSS, runId: "run_01", status: "done" }],
      statusById: { [GPT_OSS]: "done", [QWEN38]: "running", [GEMMA4]: "pending" },
      source: "server",
    });
  });

  test("완료 큐는 index가 models.length라 마지막 위치로 보정한다", () => {
    const models = [queueModel(GPT_OSS, "done"), queueModel(QWEN38, "done")];
    expect(planFromQueueSnapshot(snapshot({ index: 2, models }))?.index).toBe(1);
    // 음수·비정상 index도 범위 안으로 끌어온다.
    expect(planFromQueueSnapshot(snapshot({ index: -1, models }))?.index).toBe(0);
    expect(
      planFromQueueSnapshot({ ...snapshot({ models }), index: "1" } as unknown as BenchQueueSnapshot)?.index,
    ).toBe(0);
  });

  test("models가 비면 계획 없음 — 재연결 자체는 살려야 한다", () => {
    expect(planFromQueueSnapshot(snapshot({ models: [] }))).toBeNull();
    expect(planFromQueueSnapshot({ ...snapshot(), models: null } as unknown as BenchQueueSnapshot)).toBeNull();
    expect(planFromQueueSnapshot(null)).toBeNull();
    expect(planFromQueueSnapshot(undefined)).toBeNull();
    expect(
      planFromQueueSnapshot({ ...snapshot(), queue_id: 123 } as unknown as BenchQueueSnapshot),
    ).toBeNull();
  });

  test("plan이 없으면 시나리오·라우트를 빈 배열로 둔다 — 지어내지 않는다", () => {
    const out = planFromQueueSnapshot({ ...snapshot(), plan: undefined } as unknown as BenchQueueSnapshot);
    expect(out?.scenarioIds).toEqual([]);
    expect(out?.apiRoutes).toEqual([]);
    // 회차 기본값만 채운다.
    expect(out?.warmupRuns).toBe(1);
    expect(out?.measuredRuns).toBe(3);
  });

  test("plan이 문자열 배열이 아니면 그 항목도 빈 배열로 둔다", () => {
    const broken = {
      ...snapshot(),
      plan: { scenario_ids: [1, 2], api_routes: null, warmup_runs: "2", measured_runs: null },
    } as unknown as BenchQueueSnapshot;
    const out = planFromQueueSnapshot(broken);
    expect(out?.scenarioIds).toEqual([]);
    expect(out?.apiRoutes).toEqual([]);
    expect(out?.warmupRuns).toBe(1);
    expect(out?.measuredRuns).toBe(3);
  });

  test("done에는 pending·running이 들어가지 않는다", () => {
    const out = planFromQueueSnapshot(
      snapshot({
        index: 4,
        models: [
          queueModel(GPT_OSS, "done", { run_id: "run_01" }),
          queueModel(QWEN38, "done-with-errors", { run_id: "run_02", error_count: 2 }),
          // run_started 전에 죽은 모델은 run_id가 null이지만 그래도 완료로 센다.
          queueModel(GEMMA4, "failed"),
          queueModel("m/cancelled", "cancelled", { run_id: "run_04" }),
          queueModel("m/running", "running", { run_id: "run_05" }),
          queueModel("m/pending", "pending"),
        ],
      }),
    );
    expect(out?.done).toEqual([
      { modelId: GPT_OSS, runId: "run_01", status: "done" },
      { modelId: QWEN38, runId: "run_02", status: "done-with-errors" },
      { modelId: GEMMA4, runId: null, status: "failed" },
      { modelId: "m/cancelled", runId: "run_04", status: "cancelled" },
    ]);
  });

  test("statusById가 완료·진행·대기를 가리지 않고 모델 전부를 담는다", () => {
    const out = planFromQueueSnapshot(
      snapshot({
        models: [
          queueModel(GPT_OSS, "done", { run_id: "run_01" }),
          queueModel(QWEN38, "running", { run_id: "run_02" }),
          queueModel(GEMMA4, "pending"),
        ],
      }),
    );
    expect(Object.keys(out?.statusById ?? {})).toEqual([GPT_OSS, QWEN38, GEMMA4]);
  });
});

describe("planFromForm — queue_started 전 잠정 계획", () => {
  test("선택 모델은 전부 pending, source는 local", () => {
    const out = planFromForm({
      modelIds: [GPT_OSS, QWEN38],
      scenarioIds: ["text_basic", "vision_basic"],
      apiRoutes: ["chat_completions", "messages"],
    });
    expect(out).toEqual({
      queueId: null,
      modelIds: [GPT_OSS, QWEN38],
      index: 0,
      scenarioIds: ["text_basic", "vision_basic"],
      apiRoutes: ["chat_completions", "messages"],
      warmupRuns: 1,
      measuredRuns: 3,
      done: [],
      statusById: { [GPT_OSS]: "pending", [QWEN38]: "pending" },
      source: "local",
    });
  });

  test("폼 배열을 복사한다 — 이후 폼을 만져도 계획이 흔들리지 않는다", () => {
    const modelIds = [GPT_OSS];
    const scenarioIds = ["text_basic"];
    const apiRoutes = ["chat_completions"];
    const out = planFromForm({ modelIds, scenarioIds, apiRoutes });
    modelIds.push(QWEN38);
    scenarioIds.push("vision_basic");
    apiRoutes.push("messages");
    expect(out.modelIds).toEqual([GPT_OSS]);
    expect(out.scenarioIds).toEqual(["text_basic"]);
    expect(out.apiRoutes).toEqual(["chat_completions"]);
  });
});

describe("mergePlanWithRunMeta — run_started.meta로 확정", () => {
  test("meta가 시나리오·라우트·회차를 덮어쓴다", () => {
    const out = mergePlanWithRunMeta(
      plan(),
      {
        scenario_ids: ["vision_basic", "agent_tool"],
        api_routes: ["messages"],
        warmup_runs: 2,
        measured_runs: 5,
      },
      GPT_OSS,
    );
    expect(out?.scenarioIds).toEqual(["vision_basic", "agent_tool"]);
    expect(out?.apiRoutes).toEqual(["messages"]);
    expect(out?.warmupRuns).toBe(2);
    expect(out?.measuredRuns).toBe(5);
  });

  test("meta가 비면 기존 계획을 유지한다", () => {
    const out = mergePlanWithRunMeta(plan(), { scenario_ids: [], api_routes: [] }, GPT_OSS);
    expect(out?.scenarioIds).toEqual(["text_basic"]);
    expect(out?.apiRoutes).toEqual(["chat_completions"]);
    expect(out?.warmupRuns).toBe(1);
    expect(out?.measuredRuns).toBe(3);
  });

  test("모델 목록·인덱스·완료 정보는 건드리지 않는다", () => {
    const before = plan({
      index: 1,
      done: [{ modelId: GPT_OSS, runId: "run_01", status: "done" }],
      statusById: { [GPT_OSS]: "done", [QWEN38]: "running" },
    });
    const out = mergePlanWithRunMeta(before, { scenario_ids: ["vision_basic"] }, QWEN38);
    expect(out?.modelIds).toEqual([GPT_OSS, QWEN38]);
    expect(out?.index).toBe(1);
    expect(out?.done).toEqual(before.done);
    expect(out?.statusById).toEqual(before.statusById);
    expect(out?.queueId).toBe("q_01");
  });

  test("계획이 null이어도 meta만으로 1모델 계획을 만든다 — 버퍼 축출 폴백", () => {
    const out = mergePlanWithRunMeta(
      null,
      { scenario_ids: ["text_basic"], api_routes: ["chat_completions"], warmup_runs: 2 },
      QWEN38,
    );
    expect(out).toEqual({
      queueId: null,
      modelIds: [QWEN38],
      index: 0,
      scenarioIds: ["text_basic"],
      apiRoutes: ["chat_completions"],
      warmupRuns: 2,
      measuredRuns: 3,
      done: [],
      statusById: { [QWEN38]: "running" },
      source: "server",
    });
  });

  test("계획도 없고 meta에 시나리오·라우트도 없으면 계획을 만들지 않는다", () => {
    expect(mergePlanWithRunMeta(null, { warmup_runs: 2, measured_runs: 5 }, QWEN38)).toBeNull();
    expect(mergePlanWithRunMeta(null, { scenario_ids: [], api_routes: [] }, QWEN38)).toBeNull();
  });

  test("meta가 null이면 계획을 그대로 돌려준다", () => {
    const before = plan();
    expect(mergePlanWithRunMeta(before, null, GPT_OSS)).toBe(before);
    expect(mergePlanWithRunMeta(before, undefined, GPT_OSS)).toBe(before);
    expect(mergePlanWithRunMeta(null, null, GPT_OSS)).toBeNull();
  });
});

describe("resolvePlanView — 계획 우선, 폼 폴백", () => {
  test("계획이 없으면 폼을 그대로 쓴다 — 실행 전 동작 보존", () => {
    const draftModelIds = [GPT_OSS, QWEN38];
    const formScenarioIds = ["text_basic"];
    const formApiRoutes = ["chat_completions"];
    const out = resolvePlanView({ plan: null, draftModelIds, formScenarioIds, formApiRoutes });
    expect(out).toEqual({
      modelIds: draftModelIds,
      scenarioIds: formScenarioIds,
      apiRoutes: formApiRoutes,
      hasPlan: false,
    });
  });

  test("계획이 있으면 폼과 달라도 계획을 따른다", () => {
    const out = resolvePlanView({
      plan: plan({ modelIds: [GEMMA4], scenarioIds: ["agent_tool"], apiRoutes: ["messages"] }),
      draftModelIds: [GPT_OSS, QWEN38],
      formScenarioIds: ["text_basic", "vision_basic"],
      formApiRoutes: ["chat_completions"],
    });
    expect(out).toEqual({
      modelIds: [GEMMA4],
      scenarioIds: ["agent_tool"],
      apiRoutes: ["messages"],
      hasPlan: true,
    });
  });

  test("계획의 시나리오·라우트가 비면 폼으로 메운다 — 0/0보다 낫다", () => {
    const out = resolvePlanView({
      plan: plan({ scenarioIds: [], apiRoutes: [] }),
      draftModelIds: [GEMMA4],
      formScenarioIds: ["text_basic", "vision_basic"],
      formApiRoutes: ["chat_completions"],
    });
    expect(out.modelIds).toEqual([GPT_OSS, QWEN38]);
    expect(out.scenarioIds).toEqual(["text_basic", "vision_basic"]);
    expect(out.apiRoutes).toEqual(["chat_completions"]);
    expect(out.hasPlan).toBe(true);
  });
});

describe("planTotals — 진행률", () => {
  test("모델 × 시나리오 × 라우트", () => {
    const out = planTotals(
      view({
        modelIds: [GPT_OSS, QWEN38],
        scenarioIds: ["text_basic", "vision_basic", "agent_tool"],
        apiRoutes: ["chat_completions", "messages"],
      }),
      6,
    );
    expect(out).toEqual({ completed: 6, total: 12, pct: 50 });
  });

  test("라우트가 비면 1로 센다", () => {
    const out = planTotals(
      view({ modelIds: [GPT_OSS, QWEN38], scenarioIds: ["text_basic", "vision_basic"], apiRoutes: [] }),
      0,
    );
    expect(out.total).toBe(4);
  });

  test("시나리오를 모르면 total 0이고 pct도 0 — 0/0을 100%로 만들지 않는다", () => {
    const out = planTotals(view({ scenarioIds: [], apiRoutes: [] }), 5);
    expect(out).toEqual({ completed: 5, total: 0, pct: 0 });
  });

  test("복원 행이 총량을 넘어도 100%를 넘지 않는다", () => {
    const out = planTotals(view({ modelIds: [GPT_OSS], scenarioIds: ["text_basic"] }), 24);
    expect(out.total).toBe(1);
    expect(out.pct).toBe(100);
  });

  test("완료 수는 음수로 내려가지 않는다", () => {
    expect(planTotals(view(), -3)).toEqual({ completed: 0, total: 1, pct: 0 });
  });
});

describe("planPendingUnits — 예약 스켈레톤 단위", () => {
  const twoByTwo = view({
    modelIds: [GPT_OSS, QWEN38],
    scenarioIds: ["text_basic", "vision_basic"],
    apiRoutes: ["chat_completions", "messages"],
  });

  test("이미 결과가 있는 조합은 빠진다", () => {
    const done = scenarioRowKey("text_basic", "chat_completions", GPT_OSS);
    const units = planPendingUnits(twoByTwo, new Set([done]));
    expect(units).toHaveLength(7);
    expect(units.map((u) => u.rowKey)).not.toContain(done);
  });

  test("모델 → 시나리오 → 라우트 순서를 유지한다", () => {
    const units = planPendingUnits(twoByTwo, new Set());
    expect(units.map((u) => u.rowKey)).toEqual([
      scenarioRowKey("text_basic", "chat_completions", GPT_OSS),
      scenarioRowKey("text_basic", "messages", GPT_OSS),
      scenarioRowKey("vision_basic", "chat_completions", GPT_OSS),
      scenarioRowKey("vision_basic", "messages", GPT_OSS),
      scenarioRowKey("text_basic", "chat_completions", QWEN38),
      scenarioRowKey("text_basic", "messages", QWEN38),
      scenarioRowKey("vision_basic", "chat_completions", QWEN38),
      scenarioRowKey("vision_basic", "messages", QWEN38),
    ]);
    expect(units[0]).toEqual({
      rowKey: scenarioRowKey("text_basic", "chat_completions", GPT_OSS),
      model_id: GPT_OSS,
      scenario: "text_basic",
      api: "chat_completions",
    });
  });

  test("아직 시작하지 않은 모델의 조합도 포함한다 — 재연결 후 예약 행이 사라지면 안 된다", () => {
    // 첫 모델은 이미 다 끝난 상태(복원 행이 있음), 뒤 모델은 시작조차 안 했다.
    const restored = new Set([
      scenarioRowKey("text_basic", "chat_completions", GPT_OSS),
      scenarioRowKey("text_basic", "messages", GPT_OSS),
      scenarioRowKey("vision_basic", "chat_completions", GPT_OSS),
      scenarioRowKey("vision_basic", "messages", GPT_OSS),
    ]);
    const units = planPendingUnits(twoByTwo, restored);
    expect(units.map((u) => u.model_id)).toEqual([QWEN38, QWEN38, QWEN38, QWEN38]);
  });

  test("시나리오나 라우트를 모르면 빈 배열", () => {
    expect(planPendingUnits(view({ scenarioIds: [] }), new Set())).toEqual([]);
    expect(planPendingUnits(view({ apiRoutes: [] }), new Set())).toEqual([]);
    expect(planPendingUnits(view({ modelIds: [] }), new Set())).toEqual([]);
  });
});

describe("hydrateQueueStatus — 재접속 직후 칩", () => {
  test("완료·진행·대기가 그대로 나온다", () => {
    const statusById: Record<string, BenchQueueModelStatus> = {
      [GPT_OSS]: "done",
      [QWEN38]: "running",
      [GEMMA4]: "pending",
    };
    expect(hydrateQueueStatus(plan({ statusById }))).toEqual(statusById);
  });

  test("복사본을 돌려준다 — 칩 상태를 바꿔도 계획이 오염되지 않는다", () => {
    const before = plan({ statusById: { [GPT_OSS]: "running" } });
    const out = hydrateQueueStatus(before);
    out[QWEN38] = "done";
    expect(before.statusById).toEqual({ [GPT_OSS]: "running" });
  });
});

describe("mergeByRowKey — DB 복원 병합", () => {
  const row = (rowKey: string, from: string) => ({ rowKey, from });

  test("겹치면 라이브가 이긴다", () => {
    const out = mergeByRowKey([row("k1", "live")], [row("k1", "restored")]);
    expect(out).toEqual([row("k1", "live")]);
  });

  test("겹치지 않는 복원 행은 라이브 뒤에 붙는다", () => {
    const out = mergeByRowKey([row("k1", "live")], [row("k1", "restored"), row("k2", "restored")]);
    expect(out).toEqual([row("k1", "live"), row("k2", "restored")]);
  });

  test("복원끼리 겹치면 먼저 온 것을 유지한다", () => {
    const out = mergeByRowKey([], [row("k1", "restored-1"), row("k1", "restored-2")]);
    expect(out).toEqual([row("k1", "restored-1")]);
  });

  test("입력 배열을 변형하지 않는다", () => {
    const live = [row("k1", "live")];
    const restored = [row("k2", "restored")];
    mergeByRowKey(live, restored);
    expect(live).toHaveLength(1);
    expect(restored).toHaveLength(1);
  });
});

describe("shouldRestoreFinishedQueue — 끝난 큐 자동 복원", () => {
  test("처음 접속한 탭은 복원하지 않는다 — 남이 돌린 런의 결과가 화면을 채우면 안 된다", () => {
    expect(
      shouldRestoreFinishedQueue({ queueId: "q_01", watchedQueueId: null, hasRows: false }),
    ).toBe(false);
  });

  test("이 탭이 보던 큐면 복원한다 — 마지막 모델까지 끝난 직후 새로고침한 경우", () => {
    expect(
      shouldRestoreFinishedQueue({ queueId: "q_01", watchedQueueId: "q_01", hasRows: false }),
    ).toBe(true);
  });

  test("다른 큐면 복원하지 않는다", () => {
    expect(
      shouldRestoreFinishedQueue({ queueId: "q_02", watchedQueueId: "q_01", hasRows: false }),
    ).toBe(false);
  });

  test("화면에 이미 결과가 있으면 덮지 않는다 — 감지를 다시 눌렀을 뿐인데 데이터가 사라져 보인다", () => {
    expect(
      shouldRestoreFinishedQueue({ queueId: "q_01", watchedQueueId: "q_01", hasRows: true }),
    ).toBe(false);
  });
});

describe("resolveBenchOutcomeToast — 실행 종료 안내", () => {
  const base = { httpFailed: false, cancelled: false, errorCount: 0, sawQueueFinished: true };

  test("정상 완주는 성공", () => {
    expect(resolveBenchOutcomeToast(base)).toBe("success");
  });

  test("큐를 정지하면 완료가 아니라 중지 안내다", () => {
    // 정지는 error 이벤트를 내지 않으므로, queue_finished.status를 안 보면 "모두 완료"가 뜬다.
    expect(resolveBenchOutcomeToast({ ...base, cancelled: true })).toBe("cancelled");
  });

  test("정지가 오류보다 우선한다 — 멈춘 걸 '오류로 끝남'이라 하지 않는다", () => {
    expect(resolveBenchOutcomeToast({ ...base, cancelled: true, errorCount: 3 })).toBe("cancelled");
  });

  test("시나리오 오류가 있으면 경고", () => {
    expect(resolveBenchOutcomeToast({ ...base, errorCount: 1 })).toBe("warning");
  });

  test("queue_finished를 못 보고 끊기면 경고", () => {
    expect(resolveBenchOutcomeToast({ ...base, sawQueueFinished: false })).toBe("warning");
  });

  test("HTTP 실패는 이미 안내했으므로 아무것도 띄우지 않는다", () => {
    expect(resolveBenchOutcomeToast({ ...base, httpFailed: true, sawQueueFinished: false })).toBe("none");
  });
});
