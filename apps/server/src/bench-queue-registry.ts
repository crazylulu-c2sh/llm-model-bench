import { EventEmitter } from "node:events";
import type {
  BenchQueueModel,
  BenchQueueModelStatus,
  BenchQueuePlan,
  BenchQueueSnapshot,
  BenchQueueStreamEvent,
  ProviderKind,
} from "@llm-bench/shared";
import { cancelRunControl, pauseRunControl, resumeRunControl } from "./run-control.js";

/**
 * 서버가 소유하는 모델 큐의 상태 레지스트리. 큐 엔트리는 개별 런보다 오래 산다 —
 * 런 엔트리(`bench-live-registry.ts`)는 `endLiveRun`에서 지워지지만, 큐는 모델 경계를 넘어
 * "다음에 무엇을 돌 것인가"를 들고 있어야 한다.
 *
 * 이 모듈이 `run-control.ts`(런 단위 일시정지/취소)를 직접 부르는 이유: **일시정지 권위를
 * 큐 하나로 모으기 위해서다.** 런 쪽에도 30분 자동 재개 타이머가 있는데, 그게 큐 플래그와
 * 따로 놀면 `run_resumed`가 흘러 UI 버튼은 "재개됨"으로 돌아가는데 다음 모델은 시작되지 않는
 * 최악의 관측 상태가 된다. 타이머는 큐에만 두고, 자동 재개도 resume 라우트와 **같은 함수**를 탄다.
 *
 * Node는 단일 스레드이므로 아래 함수들 사이에 race condition은 없다(모두 동기).
 */

const MAX_BUFFERED_EVENTS = 500;
/** 완료 큐 보존 시간 — 마지막 모델이 끝난 직후 새로고침한 탭도 run_id 목록을 받아 DB 복원을 해야 한다. */
const QUEUE_RETENTION_MS = 30 * 60 * 1000;
/** 완료 큐 보존 개수 상한. 실행 중 큐는 절대 축출하지 않는다. */
const MAX_RETAINED_QUEUES = 20;
/** 일시정지 중 아무도 재개하지 않을 때(탭 종료·슬립 등)의 안전장치 — run-control과 같은 값. */
const QUEUE_PAUSE_MAX_WAIT_MS = 30 * 60 * 1000;

type QueueEntry = {
  emitter: EventEmitter;
  snapshot: BenchQueueSnapshot;
  /** 링버퍼와 무관하게 항상 replay 선두. */
  pinnedQueueStarted: BenchQueueStreamEvent | null;
  /** 현재 모델의 queue_model_started — 클라이언트가 "지금 어느 모델인지"를 이걸로 안다. */
  pinnedModelStarted: BenchQueueStreamEvent | null;
  /** 현재 모델의 run_started(meta 포함). */
  pinnedRunStarted: BenchQueueStreamEvent | null;
  /** **현재 모델**의 이벤트만. 모델 경계에서 비운다 — 완료 모델 결과는 SQLite에서 복원한다. */
  buffered: BenchQueueStreamEvent[];
  paused: boolean;
  pauseDeadline: ReturnType<typeof setTimeout> | null;
  stopRequested: boolean;
  pauseWaiters: Array<() => void>;
};

const registry = new Map<string, QueueEntry>();

/**
 * 완료 후 오래된 큐를 지운다. `setInterval` 스위퍼를 두지 않는 이유: 프로세스를 살려두는 핸들이
 * 생기고 테스트마다 언마운트가 필요한데, 이 코드베이스에 그런 선례가 없다. 조회 시점에 쓸어낸다.
 */
function sweepExpired(now: number): void {
  const finished: Array<[string, QueueEntry]> = [];
  for (const [id, entry] of registry) {
    if (entry.snapshot.status === "running") continue;
    const at = entry.snapshot.finished_at ?? entry.snapshot.created_at;
    if (now - at > QUEUE_RETENTION_MS) registry.delete(id);
    else finished.push([id, entry]);
  }
  if (finished.length > MAX_RETAINED_QUEUES) {
    finished.sort(
      (a, b) =>
        (a[1].snapshot.finished_at ?? a[1].snapshot.created_at) -
        (b[1].snapshot.finished_at ?? b[1].snapshot.created_at),
    );
    for (const [id] of finished.slice(0, finished.length - MAX_RETAINED_QUEUES)) registry.delete(id);
  }
}

export function createQueue(input: {
  queueId: string;
  baseUrl: string;
  provider: ProviderKind;
  modelIds: string[];
  plan: BenchQueuePlan;
}): BenchQueueSnapshot {
  const now = Date.now();
  sweepExpired(now);
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // 여러 탭이 동시에 구독할 수 있어 무제한 허용
  const snapshot: BenchQueueSnapshot = {
    queue_id: input.queueId,
    base_url: input.baseUrl,
    provider: input.provider,
    status: "running",
    created_at: now,
    finished_at: null,
    index: 0,
    paused: false,
    current_run_id: null,
    models: input.modelIds.map((model_id) => ({
      model_id,
      status: "pending" as BenchQueueModelStatus,
      run_id: null,
      started_at: null,
      finished_at: null,
      error_count: 0,
    })),
    plan: input.plan,
  };
  registry.set(input.queueId, {
    emitter,
    snapshot,
    pinnedQueueStarted: null,
    pinnedModelStarted: null,
    pinnedRunStarted: null,
    buffered: [],
    paused: false,
    pauseDeadline: null,
    stopRequested: false,
    pauseWaiters: [],
  });
  return snapshot;
}

/** 같은 base_url에서 지금 실행 중인 큐(있으면). 신규 큐 시작을 409로 막는 판정에 쓴다. */
export function activeQueueForBaseUrl(baseUrl: string): BenchQueueSnapshot | null {
  sweepExpired(Date.now());
  for (const entry of registry.values()) {
    if (entry.snapshot.status === "running" && entry.snapshot.base_url === baseUrl) {
      return entry.snapshot;
    }
  }
  return null;
}

export function getQueueSnapshot(queueId: string): BenchQueueSnapshot | null {
  sweepExpired(Date.now());
  return registry.get(queueId)?.snapshot ?? null;
}

/**
 * 실행 중 큐 먼저(created_at 내림차순), 그 뒤 완료 큐(finished_at 내림차순).
 * 클라이언트가 `queues[0]`을 그대로 써도 안전하도록 **서버가 정렬 책임을 진다** —
 * 삽입 순서 그대로 내보내면 완료 큐를 보존하는 순간 index 0이 옛 큐가 된다.
 */
export function listQueues(baseUrl?: string): BenchQueueSnapshot[] {
  sweepExpired(Date.now());
  const all = [...registry.values()]
    .map((e) => e.snapshot)
    .filter((s) => (baseUrl ? s.base_url === baseUrl : true));
  return all.sort((a, b) => {
    const aRunning = a.status === "running" ? 1 : 0;
    const bRunning = b.status === "running" ? 1 : 0;
    if (aRunning !== bRunning) return bRunning - aRunning;
    if (aRunning === 1) return b.created_at - a.created_at;
    return (b.finished_at ?? b.created_at) - (a.finished_at ?? a.created_at);
  });
}

/**
 * 버퍼·핀 계약:
 *  - `queue_model_started`는 **리셋 → 핀** 순서로 처리한다. 반대로 하면 이 이벤트가 사라져
 *    재연결한 클라이언트가 현재 모델이 무엇인지 못 받는다.
 *  - replay 순서는 `queue_started → queue_model_started → run_started → 현재 모델 버퍼`로 고정.
 *    셋 다 버퍼가 아니라 핀에 두므로 링버퍼가 넘쳐도 이 순서는 깨지지 않는다.
 */
export function publishQueueEvent(queueId: string, ev: BenchQueueStreamEvent): void {
  const entry = registry.get(queueId);
  if (!entry) return;
  if (ev.type === "queue_started") {
    entry.pinnedQueueStarted = ev;
  } else if (ev.type === "queue_model_started") {
    entry.buffered = [];
    entry.pinnedRunStarted = null;
    entry.pinnedModelStarted = ev;
  } else if (ev.type === "queue_model_finished") {
    // 모델 경계(다음 모델이 시작되기 전, 예: 여기서 일시정지)에 재연결하는 탭이 있다.
    // 끝난 모델의 컨텍스트를 남겨두면 그 탭은 replay로 죽은 run_id와 "진행 중" 표시를 받는다.
    // 끝난 모델의 결과는 SQLite에서 복원하므로 라이브 버퍼가 들고 있을 이유가 없다.
    entry.buffered = [];
    entry.pinnedModelStarted = null;
    entry.pinnedRunStarted = null;
  } else if (ev.type === "run_started" && entry.pinnedRunStarted === null) {
    entry.pinnedRunStarted = ev;
  } else if (ev.type !== "token_delta" && entry.snapshot.status === "running") {
    entry.buffered.push(ev);
    if (entry.buffered.length > MAX_BUFFERED_EVENTS) entry.buffered.shift();
  }
  entry.emitter.emit("event", ev);
}

export function markModelRunning(queueId: string, index: number): void {
  const entry = registry.get(queueId);
  const model = entry?.snapshot.models[index];
  if (!entry || !model) return;
  entry.snapshot.index = index;
  entry.snapshot.current_run_id = null;
  model.status = "running";
  model.started_at = Date.now();
}

/** `run_started` 수신 시 — 이 run_id가 DB 복원 키이자 재연결 대상이다. */
export function markModelRunId(queueId: string, index: number, runId: string): void {
  const entry = registry.get(queueId);
  const model = entry?.snapshot.models[index];
  if (!entry || !model) return;
  model.run_id = runId;
  entry.snapshot.current_run_id = runId;
}

export function markModelFinished(
  queueId: string,
  index: number,
  result: { status: BenchQueueModelStatus; errorCount: number },
): void {
  const entry = registry.get(queueId);
  const model = entry?.snapshot.models[index];
  if (!entry || !model) return;
  model.status = result.status;
  model.error_count = result.errorCount;
  model.finished_at = Date.now();
  entry.snapshot.current_run_id = null;
  // 커서를 "다음에 실행할 모델"로 옮긴다 — 끝난 모델을 계속 가리키면 모델 경계에서 재연결한
  // 클라이언트가 그 모델을 현재 실행 중인 것으로 그린다. 실행 중 여부는 current_run_id가 말한다.
  entry.snapshot.index = Math.min(index + 1, entry.snapshot.models.length);
}

/** 아직 시작하지 않은 모델을 중지됨으로 표시(긴급 정지). */
export function markRemainingCancelled(queueId: string, fromIndex: number): void {
  const entry = registry.get(queueId);
  if (!entry) return;
  for (const model of entry.snapshot.models.slice(fromIndex)) {
    if (model.status === "pending") model.status = "cancelled";
  }
}

export function isQueueStopRequested(queueId: string): boolean {
  return registry.get(queueId)?.stopRequested ?? false;
}

/**
 * 큐 일시정지. 진행 중인 런이 있으면 런에도 위임하지만, **위임 결과를 HTTP 상태로 쓰지 않는다** —
 * 모델 경계(런이 없는 순간)에 누른 정상적인 일시정지가 404가 되어버린다.
 */
export function pauseQueue(queueId: string): boolean {
  const entry = registry.get(queueId);
  if (!entry || entry.snapshot.status !== "running" || entry.stopRequested) return false;
  if (!entry.paused) {
    entry.paused = true;
    entry.snapshot.paused = true;
    const timer = setTimeout(() => resumeQueue(queueId), QUEUE_PAUSE_MAX_WAIT_MS);
    timer.unref?.();
    entry.pauseDeadline = timer;
    publishQueueEvent(queueId, { type: "queue_paused", queue_id: queueId });
  }
  if (entry.snapshot.current_run_id) pauseRunControl(entry.snapshot.current_run_id);
  return true;
}

/** 자동 재개(30분 데드라인)도 이 함수를 그대로 탄다 — 경로가 갈라지면 플래그가 어긋난다. */
export function resumeQueue(queueId: string): boolean {
  const entry = registry.get(queueId);
  if (!entry || entry.snapshot.status !== "running") return false;
  if (entry.pauseDeadline) {
    clearTimeout(entry.pauseDeadline);
    entry.pauseDeadline = null;
  }
  const was = entry.paused;
  entry.paused = false;
  entry.snapshot.paused = false;
  for (const wake of entry.pauseWaiters.splice(0)) wake();
  if (entry.snapshot.current_run_id) resumeRunControl(entry.snapshot.current_run_id);
  if (was) publishQueueEvent(queueId, { type: "queue_resumed", queue_id: queueId });
  return true;
}

/**
 * 큐 전체 정지. 일시정지 대기 중인 루프를 **반드시 깨워야** 한다 —
 * 안 그러면 "일시정지 중 정지"가 최대 30분 뒤에야 먹는다.
 */
export function requestQueueStop(queueId: string): boolean {
  const entry = registry.get(queueId);
  if (!entry || entry.snapshot.status !== "running") return false;
  entry.stopRequested = true;
  if (entry.pauseDeadline) {
    clearTimeout(entry.pauseDeadline);
    entry.pauseDeadline = null;
  }
  entry.paused = false;
  entry.snapshot.paused = false;
  for (const wake of entry.pauseWaiters.splice(0)) wake();
  if (entry.snapshot.current_run_id) cancelRunControl(entry.snapshot.current_run_id);
  return true;
}

/** 일시정지 중이면 재개(또는 정지)까지 대기. 자체 타이머는 두지 않는다 — 데드라인은 큐에 하나뿐이다. */
export function waitWhileQueuePaused(queueId: string): Promise<void> {
  return new Promise((resolve) => {
    const entry = registry.get(queueId);
    if (!entry || !entry.paused || entry.stopRequested) {
      resolve();
      return;
    }
    let settled = false;
    entry.pauseWaiters.push(() => {
      if (settled) return;
      settled = true;
      resolve();
    });
  });
}

export function finishQueue(queueId: string, status: "finished" | "cancelled"): void {
  const entry = registry.get(queueId);
  if (!entry) return;
  if (entry.pauseDeadline) {
    clearTimeout(entry.pauseDeadline);
    entry.pauseDeadline = null;
  }
  entry.snapshot.status = status;
  entry.snapshot.finished_at = Date.now();
  entry.snapshot.paused = false;
  entry.snapshot.current_run_id = null;
  entry.snapshot.index = entry.snapshot.models.length;
  entry.paused = false;
  for (const wake of entry.pauseWaiters.splice(0)) wake();
  // 완료 큐는 재연결 대상이 아니다(클라이언트는 DB에서 복원한다) — 메모리를 즉시 돌려준다.
  entry.buffered = [];
  entry.pinnedQueueStarted = null;
  entry.pinnedModelStarted = null;
  entry.pinnedRunStarted = null;
  entry.emitter.emit("done");
}

export type QueueSubscription = {
  /** 재연결 시 즉시 재생할 이벤트 — queue_started → queue_model_started → run_started → 현재 모델 버퍼. */
  bufferedEvents: BenchQueueStreamEvent[];
  onEvent(cb: (ev: BenchQueueStreamEvent) => void): void;
  onDone(cb: () => void): void;
  unsubscribe(): void;
};

export function subscribeToQueue(queueId: string): QueueSubscription | null {
  const entry = registry.get(queueId);
  if (!entry || entry.snapshot.status !== "running") return null;
  const listeners: { event?: (ev: BenchQueueStreamEvent) => void; done?: () => void } = {};
  const head = [entry.pinnedQueueStarted, entry.pinnedModelStarted, entry.pinnedRunStarted].filter(
    (ev): ev is BenchQueueStreamEvent => ev !== null,
  );
  return {
    bufferedEvents: [...head, ...entry.buffered],
    onEvent(cb) {
      listeners.event = cb;
      entry.emitter.on("event", cb);
    },
    onDone(cb) {
      listeners.done = cb;
      entry.emitter.on("done", cb);
    },
    unsubscribe() {
      if (listeners.event) entry.emitter.off("event", listeners.event);
      if (listeners.done) entry.emitter.off("done", listeners.done);
    },
  };
}

export type { BenchQueueModel };

/** 테스트 전용 — 현재 모델의 버퍼 길이(완료 큐는 0이어야 한다). */
export function _bufferedCountForTests(queueId: string): number | null {
  const entry = registry.get(queueId);
  return entry ? entry.buffered.length : null;
}

/**
 * 테스트 전용 — 모듈 레벨 Map을 초기화.
 * 그냥 비우면 **아직 돌고 있는 드라이버 루프가 고아로 남아** 다음 테스트의 fetch 스텁을 오염시킨다.
 * 지우기 전에 정지 플래그를 세우고 대기자를 깨워 루프가 즉시 빠져나가게 한다.
 */
export function _resetBenchQueueRegistryForTests(): void {
  for (const [queueId, entry] of registry) {
    if (entry.snapshot.status === "running") requestQueueStop(queueId);
    if (entry.pauseDeadline) clearTimeout(entry.pauseDeadline);
  }
  registry.clear();
}
