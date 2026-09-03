import { describe, expect, test } from "vitest";
import {
  classifyModelOutcome,
  collapseQueue,
  isStepOpen,
  overrideAfterRunEnd,
  resolveActiveStep,
  resolveQueueItems,
  resolveStepStatus,
  shouldResetOverride,
  toggleStepOverride,
  type BenchPhase,
  type ModelRunOutcome,
  type QueueItem,
  type QueueSource,
  type StepDoneInput,
} from "./bench-steps";

const phase = (over: Partial<BenchPhase> = {}): BenchPhase => ({
  detected: true,
  reachable: true,
  detecting: false,
  running: false,
  resultCount: 0,
  ...over,
});

describe("resolveActiveStep — 국면", () => {
  test("감지 전에는 1단계", () => {
    expect(resolveActiveStep(phase({ detected: false }), null)).toBe(1);
  });

  test("감지 성공 후에는 설정 허브(4단계)", () => {
    expect(resolveActiveStep(phase(), 1)).toBe(4);
  });

  test("프로바이더에 닿지 못했으면 1단계에 머문다 — 유일한 실패 설명이 접히면 안 된다", () => {
    expect(resolveActiveStep(phase({ reachable: false }), 1)).toBe(1);
    expect(resolveActiveStep(phase({ reachable: false }), 4)).toBe(1);
  });

  test("실행 중에는 5단계, 결과가 있으면 6단계", () => {
    expect(resolveActiveStep(phase({ running: true }), 4)).toBe(5);
    expect(resolveActiveStep(phase({ resultCount: 24 }), 5)).toBe(6);
  });

  test("첫 감지 중에는 1단계에 머문다 — 스피너가 접힌 본문으로 사라지면 안 된다", () => {
    expect(resolveActiveStep(phase({ detected: false, detecting: true }), 1)).toBe(1);
  });

  test("재탐지는 단계를 튀게 하지 않는다 (runDetect가 detect/rows를 즉시 비워도 4단계 유지)", () => {
    // runDetect 직후: detect=null, rows=[], detecting=true
    const during = resolveActiveStep(phase({ detected: false, detecting: true, resultCount: 0 }), 4);
    expect(during).toBe(4);
    // 응답 도착
    expect(resolveActiveStep(phase(), during)).toBe(4);
  });

  test("사용자 입력(모델/시나리오 선택)으로는 국면이 바뀌지 않는다", () => {
    // 4단계에서 모델을 1개 고르든 3개 고르든 국면 입력이 그대로면 4단계에 머문다.
    const before = resolveActiveStep(phase(), 4);
    const after = resolveActiveStep(phase(), before);
    expect(before).toBe(4);
    expect(after).toBe(4);
  });
});

describe("shouldResetOverride / overrideAfterRunEnd", () => {
  test("국면이 바뀔 때만 고정을 푼다", () => {
    expect(shouldResetOverride(4, 5)).toBe(true);
    expect(shouldResetOverride(4, 4)).toBe(false);
    expect(shouldResetOverride(null, 1)).toBe(false);
  });

  test("결과 없이 끝나면 5단계를 고정해 로그를 남긴다", () => {
    expect(overrideAfterRunEnd(0)).toBe(5);
    expect(overrideAfterRunEnd(16)).toBeNull();
  });
});

describe("isStepOpen / toggleStepOverride — 헤더 클릭 의미론", () => {
  test("자동 추적에서는 활성 단계만 열린다", () => {
    expect(isStepOpen(4, null, 4)).toBe(true);
    expect(isStepOpen(2, null, 4)).toBe(false);
  });

  test("실행 중(5단계 국면)에는 6단계도 함께 열린다 — 라이브 결과", () => {
    expect(isStepOpen(5, null, 5)).toBe(true);
    expect(isStepOpen(6, null, 5)).toBe(true);
    expect(isStepOpen(4, null, 5)).toBe(false);
  });

  test("열린 단계를 클릭하면 접힌다 (전부 접힘 허용)", () => {
    const next = toggleStepOverride(4, null, 4);
    expect(next).toBe("closed");
    expect(isStepOpen(4, next, 4)).toBe(false);
  });

  test("접힌 단계를 클릭하면 그 단계만 열린다", () => {
    const next = toggleStepOverride(2, null, 4);
    expect(next).toBe(2);
    expect(isStepOpen(2, next, 4)).toBe(true);
    expect(isStepOpen(4, next, 4)).toBe(false);
  });

  test("고정한 단계를 다시 클릭하면 접힌다 — 다른 카드가 갑자기 펼쳐지지 않는다", () => {
    const pinned = toggleStepOverride(2, null, 4);
    const next = toggleStepOverride(2, pinned, 4);
    expect(next).toBe("closed");
    // 4단계(활성)가 대신 열려 레이아웃이 튀는 일이 없어야 한다.
    expect(isStepOpen(4, next, 4)).toBe(false);
  });
});

describe("resolveStepStatus — 배지", () => {
  const done = (over: Partial<StepDoneInput> = {}): StepDoneInput => ({
    connectionUsable: true,
    selectedScenarioCount: 8,
    selectedModelCount: 3,
    running: false,
    resultCount: 0,
    ...over,
  });

  test("활성 단계는 완료 여부와 무관하게 active", () => {
    expect(resolveStepStatus(4, 4, done())).toBe("active");
  });

  test("완료 술어는 activeStep과 독립적이다", () => {
    expect(resolveStepStatus(1, 4, done())).toBe("done");
    expect(resolveStepStatus(2, 4, done({ selectedScenarioCount: 0 }))).toBe("pending");
  });

  test("프로바이더에 닿지 못해 모델이 0개면 연결 단계는 완료가 아니다", () => {
    expect(resolveStepStatus(1, 4, done({ connectionUsable: false }))).toBe("pending");
  });

  test("설정(3단계)은 완료 개념이 없다", () => {
    expect(resolveStepStatus(3, 4, done())).toBe("pending");
  });

  test("5단계는 실행이 끝나고 결과가 있어야 완료", () => {
    expect(resolveStepStatus(5, 6, done({ resultCount: 16 }))).toBe("done");
    expect(resolveStepStatus(5, 4, done({ resultCount: 0 }))).toBe("pending");
  });
});

describe("classifyModelOutcome", () => {
  const outcome = (over: Partial<ModelRunOutcome> = {}): ModelRunOutcome => ({
    httpFailed: false,
    threw: false,
    sawRunFinished: true,
    cancelled: false,
    skippedByPreflight: false,
    scenarioErrorCount: 0,
    ...over,
  });

  test("정상 종료는 done", () => {
    expect(classifyModelOutcome(outcome())).toBe("done");
  });

  test("긴급 정지는 run_finished를 받아도 cancelled — 완료로 오판하면 안 된다", () => {
    expect(classifyModelOutcome(outcome({ cancelled: true, sawRunFinished: true }))).toBe("cancelled");
  });

  test("시나리오 일부 오류는 실패가 아니라 부분 오류", () => {
    expect(classifyModelOutcome(outcome({ scenarioErrorCount: 1 }))).toBe("done-with-errors");
  });

  test("HTTP 실패·예외·run_finished 없음·preflight skip은 failed", () => {
    expect(classifyModelOutcome(outcome({ httpFailed: true }))).toBe("failed");
    expect(classifyModelOutcome(outcome({ threw: true }))).toBe("failed");
    expect(classifyModelOutcome(outcome({ sawRunFinished: false }))).toBe("failed");
    expect(classifyModelOutcome(outcome({ skippedByPreflight: true }))).toBe("failed");
  });
});

describe("resolveQueueItems — 칩 소스 2단", () => {
  const source = (over: Partial<QueueSource> = {}): QueueSource => ({
    running: false,
    paused: false,
    queuedIds: [],
    statusById: {},
    selectedIds: [],
    currentModelId: null,
    ...over,
  });

  test("실행 전에는 선택 모델을 큐 순서대로 미리 보여준다", () => {
    expect(resolveQueueItems(source({ selectedIds: ["a", "b"] }))).toEqual([
      { id: "a", status: "pending" },
      { id: "b", status: "pending" },
    ]);
  });

  test("실행 중에는 큐 + 모델별 상태", () => {
    expect(
      resolveQueueItems(
        source({
          running: true,
          queuedIds: ["a", "b", "c"],
          statusById: { a: "done", b: "running" },
          selectedIds: ["a", "b", "c"],
        }),
      ),
    ).toEqual([
      { id: "a", status: "done" },
      { id: "b", status: "running" },
      { id: "c", status: "pending" },
    ]);
  });

  test("일시정지 중에는 진행 중 칩이 paused로 바뀐다", () => {
    const items = resolveQueueItems(
      source({
        running: true,
        paused: true,
        queuedIds: ["a", "b"],
        statusById: { a: "done", b: "running" },
        selectedIds: ["a", "b"],
      }),
    );
    expect(items[1]).toEqual({ id: "b", status: "paused" });
  });

  test("실행 직후에는 결과 칩이 남는다", () => {
    expect(
      resolveQueueItems(
        source({ queuedIds: ["a"], statusById: { a: "failed" }, selectedIds: ["a"] }),
      ),
    ).toEqual([{ id: "a", status: "failed" }]);
  });

  test("실행 후 선택을 바꾸면 이전 실행의 칩이 남지 않는다", () => {
    expect(
      resolveQueueItems(
        source({ queuedIds: ["a"], statusById: { a: "failed" }, selectedIds: ["a", "b"] }),
      ),
    ).toEqual([
      { id: "a", status: "pending" },
      { id: "b", status: "pending" },
    ]);
  });

  test("재연결로 큐를 복원했으면 선택이 비어도 결과 칩이 남는다", () => {
    // 재접속한 탭은 모델을 고른 적이 없어 selectedIds가 비어 있다. 이걸 "선택을 바꿨다"로 보면
    // 런이 끝나는 순간(running:false) 복원해 둔 칩이 통째로 사라진다.
    expect(
      resolveQueueItems(
        source({
          running: false,
          queuedIds: ["a", "b"],
          statusById: { a: "done", b: "done-with-errors" },
          selectedIds: [],
        }),
      ),
    ).toEqual([
      { id: "a", status: "done" },
      { id: "b", status: "done-with-errors" },
    ]);
  });

  test("실행 후 선택 순서만 바뀌어도 stale — 선택 기준으로 되돌아간다", () => {
    // 위와 대비: 선택이 있으면(길이가 같아도 순서가 다르면) 다음 실행 계획을 보여줘야 한다.
    expect(
      resolveQueueItems(
        source({
          running: false,
          queuedIds: ["a", "b"],
          statusById: { a: "done", b: "failed" },
          selectedIds: ["b", "a"],
        }),
      ),
    ).toEqual([
      { id: "b", status: "pending" },
      { id: "a", status: "pending" },
    ]);
  });

  test("새로고침 후 재연결 — 큐가 비어도 현재 모델 칩은 보여준다", () => {
    expect(
      resolveQueueItems(source({ running: true, currentModelId: "b", selectedIds: [] })),
    ).toEqual([{ id: "b", status: "running" }]);
  });
});

describe("collapseQueue", () => {
  const item = (id: string, status: QueueItem["status"]): QueueItem => ({ id, status });

  test("최대치 이하면 그대로 둔다", () => {
    const items = [item("a", "done"), item("b", "running")];
    expect(collapseQueue(items, 8)).toEqual({ items, hiddenCount: 0 });
  });

  test("길면 접되 실행 순서는 유지한다", () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`m${i}`, "pending"));
    const out = collapseQueue(items, 8);
    expect(out.items).toHaveLength(8);
    expect(out.hiddenCount).toBe(4);
    expect(out.items.map((i) => i.id)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7"]);
  });

  test("진행중·실패·중지 칩은 접히지 않는다", () => {
    const items = [
      ...Array.from({ length: 9 }, (_, i) => item(`d${i}`, "done")),
      item("boom", "failed"),
      item("now", "running"),
    ];
    const out = collapseQueue(items, 8);
    const ids = out.items.map((i) => i.id);
    expect(ids).toContain("boom");
    expect(ids).toContain("now");
    expect(out.hiddenCount).toBe(items.length - out.items.length);
  });
});
