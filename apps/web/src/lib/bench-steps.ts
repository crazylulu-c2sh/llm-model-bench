/**
 * 모델 벤치("/") 6단계 아코디언의 파생 상태·전이 규칙.
 *
 * App.tsx에서 이 로직을 인라인으로 두면 회귀를 잡을 방법이 수동 확인밖에 없어서 순수 함수로 분리한다.
 * 핵심 규칙 두 가지:
 *  1) `activeStep`은 진척도가 아니라 **국면**이다. 체크박스 토글 같은 사용자 입력으로는 절대 바뀌지 않고,
 *     시스템 이벤트(감지 완료·실행 시작·실행 종료)에서만 움직인다. "첫 미완료 단계"로 계산하면 4단계에서
 *     첫 모델을 고르는 순간 표가 접혀 두 번째 모델을 고를 수 없다.
 *  2) 헤더 클릭은 **순수 토글**이다. 자동 추적으로의 복귀도 시스템 이벤트에서만 일어난다.
 */

export const STEP_NUMBERS = [1, 2, 3, 4, 5, 6] as const;
export type StepNumber = (typeof STEP_NUMBERS)[number];

/** `null`=자동 추적(국면을 따름), `"closed"`=전부 접힘, 숫자=해당 단계 고정 오픈. */
export type StepOverride = StepNumber | "closed" | null;

export type StepStatus = "pending" | "active" | "done";

// ---------------------------------------------------------------- 국면

export type BenchPhase = {
  /** `detect != null` */
  detected: boolean;
  detecting: boolean;
  running: boolean;
  /** `rows.length` */
  resultCount: number;
};

/**
 * 열려 있어야 할 단계.
 *
 * `detecting` 중에는 국면을 바꾸지 않는다 — `runDetect`가 `detect`/`rows`를 즉시 비우기 때문에
 * 그대로 계산하면 재탐지할 때마다 4→1→4로 두 번 튀고, 방금 누른 버튼과 스피너가 접힌 본문 안으로 사라진다.
 */
export function resolveActiveStep(phase: BenchPhase, prevActive: StepNumber | null): StepNumber {
  if (phase.detecting) return prevActive ?? 1;
  if (!phase.detected) return 1;
  if (phase.running) return 5;
  if (phase.resultCount > 0) return 6;
  return 4;
}

/** 국면이 바뀌면 사용자의 고정을 풀어 자동 추적으로 되돌린다. */
export function shouldResetOverride(prevActive: StepNumber | null, nextActive: StepNumber): boolean {
  return prevActive !== null && prevActive !== nextActive;
}

/**
 * 실행이 끝난 직후의 고정값. 결과가 하나도 없이 끝났으면(전부 HTTP 실패, 첫 모델 직후 긴급 정지 등)
 * 국면상으로는 설정 허브(4)로 돌아가지만, 그러면 실패 원인이 접힌 5단계 로그 안에 숨는다. 5단계를 고정해서 연다.
 */
export function overrideAfterRunEnd(resultCount: number): StepOverride {
  return resultCount > 0 ? null : 5;
}

// ---------------------------------------------------------------- 열림/토글

/** 자동 추적에서 5단계 국면일 때 6단계도 함께 연다 — 실행 중 라이브 결과를 보려면 필요하다. */
export function isStepOpen(step: StepNumber, override: StepOverride, active: StepNumber): boolean {
  if (override === "closed") return false;
  if (override !== null) return override === step;
  if (active === 5) return step === 5 || step === 6;
  return step === active;
}

/** 헤더 클릭: 열려 있으면 접고, 접혀 있으면 그 단계만 연다. 전부 접힌 상태를 허용한다(WAI-ARIA 아코디언). */
export function toggleStepOverride(
  step: StepNumber,
  override: StepOverride,
  active: StepNumber,
): StepOverride {
  return isStepOpen(step, override, active) ? "closed" : step;
}

// ---------------------------------------------------------------- 배지 상태

export type StepDoneInput = {
  /**
   * 감지에 성공했고 실제로 벤치에 쓸 모델이 있는지.
   * `detect != null`만 보면 프로바이더에 닿지 못해 모델 0개로 돌아온 경우에도 완료 체크가 켜져
   * "연결됨"과 "모델이 없으니 다시 감지하세요"가 한 화면에서 서로 반박한다.
   */
  connectionUsable: boolean;
  selectedScenarioCount: number;
  selectedModelCount: number;
  running: boolean;
  resultCount: number;
};

/** 배지의 "완료" 표시. `activeStep`(어느 단계를 열지)과 분리해야 첫 입력에 단계가 접히지 않는다. */
export function isStepDone(step: StepNumber, input: StepDoneInput): boolean {
  switch (step) {
    case 1:
      return input.connectionUsable;
    case 2:
      return input.selectedScenarioCount > 0;
    case 3:
      // 설정은 항상 유효한 기본값을 가지므로 완료/미완료 개념이 없다.
      return false;
    case 4:
      return input.selectedModelCount > 0;
    case 5:
      return !input.running && input.resultCount > 0;
    case 6:
      return false;
  }
}

export function resolveStepStatus(
  step: StepNumber,
  active: StepNumber,
  input: StepDoneInput,
): StepStatus {
  if (step === active) return "active";
  return isStepDone(step, input) ? "done" : "pending";
}

// ---------------------------------------------------------------- 큐 칩

export type QueueModelStatus =
  | "pending"
  | "running"
  | "paused"
  | "done"
  | "done-with-errors"
  | "failed"
  | "cancelled";

export type QueueItem = { id: string; status: QueueModelStatus };

/** `runBench` 루프가 모델 1건마다 채우는 관측치. 런 전체 누적값과 별개로 모델별로 모아야 한다. */
export type ModelRunOutcome = {
  httpFailed: boolean;
  threw: boolean;
  /** `run_finished` 이벤트를 받았는지 */
  sawRunFinished: boolean;
  /** `run_finished`의 사유가 취소였거나, 긴급 정지로 건너뛴 모델 */
  cancelled: boolean;
  skippedByPreflight: boolean;
  scenarioErrorCount: number;
};

/**
 * 취소를 가장 먼저 본다 — 긴급 정지도 `run_finished`를 내보내므로 순서를 바꾸면 중지된 모델이 "완료"로 찍힌다.
 * 시나리오 일부만 실패한 경우는 나머지 결과가 유효하므로 실패가 아니라 부분 오류로 분류한다.
 */
export function classifyModelOutcome(outcome: ModelRunOutcome): QueueModelStatus {
  if (outcome.cancelled) return "cancelled";
  if (outcome.skippedByPreflight) return "failed";
  if (outcome.httpFailed || outcome.threw || !outcome.sawRunFinished) return "failed";
  return outcome.scenarioErrorCount > 0 ? "done-with-errors" : "done";
}

export type QueueSource = {
  running: boolean;
  paused: boolean;
  /** `benchQueueDraft`의 모델 id — 실행 확인 시점에만 채워진다. */
  queuedIds: string[];
  statusById: Readonly<Record<string, QueueModelStatus>>;
  /** `orderedSelectedModels`의 id — 실행 전/선택 변경 후 폴백. */
  selectedIds: string[];
  /** 새로고침 후 재연결처럼 큐가 비어 있는데 실행 중인 경우의 폴백. */
  currentModelId: string | null;
};

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * 칩 소스 2단.
 *  - 실행 중/직후: `benchQueueDraft` + 모델별 상태
 *  - 실행 전, 또는 실행 후 선택을 바꿨을 때: 선택 모델 전부 `pending` (실행 전에도 큐 순서를 미리 보여준다)
 *  - 재연결로 큐가 비어 있으면 현재 모델 하나만
 */
export function resolveQueueItems(source: QueueSource): QueueItem[] {
  if (source.queuedIds.length > 0) {
    const staleAfterRun = !source.running && !sameOrder(source.queuedIds, source.selectedIds);
    if (!staleAfterRun) {
      return source.queuedIds.map((id) => {
        const status = source.statusById[id] ?? "pending";
        return { id, status: source.paused && status === "running" ? "paused" : status };
      });
    }
  } else if (source.running && source.currentModelId) {
    return [{ id: source.currentModelId, status: source.paused ? "paused" : "running" }];
  }
  return source.selectedIds.map((id) => ({ id, status: "pending" as const }));
}

// ---------------------------------------------------------------- 칩 접기

export const QUEUE_CHIP_VISIBLE_MAX = 8;

/** 접었을 때도 반드시 남겨야 하는 상태 — 사용자가 알아야 할 정보를 담고 있다. */
const ALWAYS_VISIBLE: ReadonlySet<QueueModelStatus> = new Set<QueueModelStatus>([
  "running",
  "paused",
  "failed",
  "done-with-errors",
  "cancelled",
]);

export type QueueDisplay = { items: QueueItem[]; hiddenCount: number };

/**
 * 큐가 길면(모델 10개 이상은 흔하다) 헤더가 본문보다 커지므로 접는다.
 * 실행 순서는 그 자체로 정보이므로 정렬을 바꾸지 않고, 접을 때 어떤 칩을 남길지만 고른다.
 */
export function collapseQueue(items: QueueItem[], max = QUEUE_CHIP_VISIBLE_MAX): QueueDisplay {
  if (items.length <= max) return { items, hiddenCount: 0 };

  const keep = new Set<number>();
  items.forEach((item, i) => {
    if (ALWAYS_VISIBLE.has(item.status)) keep.add(i);
  });
  for (let i = 0; i < items.length && keep.size < max; i += 1) keep.add(i);

  return {
    items: items.filter((_, i) => keep.has(i)),
    hiddenCount: items.length - keep.size,
  };
}
