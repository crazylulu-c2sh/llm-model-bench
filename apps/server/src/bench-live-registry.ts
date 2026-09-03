import { EventEmitter } from "node:events";
import type { BenchQueuePlan, StreamEvent } from "@llm-bench/shared";

/**
 * 진행 중인 벤치 런의 실시간 이벤트를 여러 구독자(원 요청 + 새로고침 후 재연결한 탭들)에게
 * 브로드캐스트하기 위한 모듈 레벨 레지스트리. `run-control.ts`(일시정지/취소 신호)와는
 * 별개 관심사 — 이쪽은 "누가 지금 이 런을 보고 있는가"만 다룬다.
 *
 * `token_delta`를 제외한 최근 이벤트를 캡에 걸어 버퍼링해 두었다가, 재연결 시 그대로
 * replay하면 클라이언트가 새로고침 전과 동일한 이벤트 처리 파이프라인으로 상태를
 * 재구성할 수 있다(서버가 별도 "스냅샷" 포맷을 만들 필요가 없다).
 */

type LiveRunInfo = {
  base_url: string;
  model_id: string;
  provider: string;
  started_at: number;
  /** run_started.meta에서 파생 — SSE를 열지 않고도 시나리오 목록·반복 수를 알 수 있게. */
  plan?: BenchQueuePlan | null;
  /** 이 런이 속한 서버 큐. 단독 /bench/stream이면 null. */
  queue_id?: string | null;
};

type LiveEntry = {
  emitter: EventEmitter;
  info: LiveRunInfo;
  paused: boolean;
  /**
   * 링버퍼 축출과 무관하게 보존하는 최초 run_started(meta 포함).
   * 이게 밀려나면 재연결 탭이 시나리오 계획·warmup/measured·run_id를 통째로 잃는다
   * (일시정지/정지 버튼이 죽고 워밍업 라벨이 기본값으로 떨어진다).
   */
  pinnedRunStarted: StreamEvent | null;
  /** token_delta·핀된 run_started 제외, 최대 MAX_BUFFERED_EVENTS개 — 재연결 시 그대로 replay. */
  buffered: StreamEvent[];
};

const MAX_BUFFERED_EVENTS = 500;

const registry = new Map<string, LiveEntry>();

export function startLiveRun(runId: string, info: LiveRunInfo): void {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // 여러 탭이 동시에 재연결할 수 있어 무제한 허용
  registry.set(runId, { emitter, info, paused: false, pinnedRunStarted: null, buffered: [] });
}

export function publishLiveEvent(runId: string, ev: StreamEvent): void {
  const entry = registry.get(runId);
  if (!entry) return;
  if (ev.type === "run_paused") entry.paused = true;
  if (ev.type === "run_resumed") entry.paused = false;
  if (ev.type === "run_started" && entry.pinnedRunStarted === null) {
    // 핀에만 저장한다 — buffered에도 넣으면 replay에서 두 번 나간다.
    entry.pinnedRunStarted = ev;
  } else if (ev.type !== "token_delta") {
    entry.buffered.push(ev);
    if (entry.buffered.length > MAX_BUFFERED_EVENTS) entry.buffered.shift();
  }
  entry.emitter.emit("event", ev);
}

export function endLiveRun(runId: string): void {
  const entry = registry.get(runId);
  if (!entry) return;
  entry.emitter.emit("done");
  registry.delete(runId);
}

export type LiveRunSubscription = {
  /** 재연결 시 즉시 재생할, 지금까지의 버퍼링된 이벤트(가장 오래된 것부터). */
  bufferedEvents: StreamEvent[];
  onEvent(cb: (ev: StreamEvent) => void): void;
  onDone(cb: () => void): void;
  unsubscribe(): void;
};

export function subscribeToLiveRun(runId: string): LiveRunSubscription | null {
  const entry = registry.get(runId);
  if (!entry) return null;
  const listeners: { event?: (ev: StreamEvent) => void; done?: () => void } = {};
  return {
    // run_started가 항상 replay 선두 — 클라이언트의 워밍업/측정 구분이 이 순서에 의존한다.
    bufferedEvents: entry.pinnedRunStarted
      ? [entry.pinnedRunStarted, ...entry.buffered]
      : [...entry.buffered],
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

/**
 * `POST /bench/stream`이 수락된 시점부터 `run_started`가 나오기까지의 예약.
 *
 * 라이브 등록은 `run_started` 이후인데, 그 앞에는 감지·프리플라이트·모델 로드(LM Studio는 수십 초)가
 * 있다. 그 창 동안 `listLiveRuns()`는 비어 보이므로, 예약이 없으면 `POST /bench/queue`가 "이 백엔드는
 * 한가하다"고 판단해 큐를 띄우고 결국 벤치 두 건이 겹친다 — 막으려던 바로 그 오염이다.
 */
const streamReservations = new Map<string, string>(); // token → normalized base_url

export function reserveStreamRun(baseUrl: string): string {
  const token = `res_${Math.random().toString(36).slice(2)}_${streamReservations.size}`;
  streamReservations.set(token, baseUrl);
  return token;
}

export function releaseStreamRun(token: string): void {
  streamReservations.delete(token);
}

/**
 * 이 baseUrl에서 **큐에 속하지 않은** 벤치가 진행 중인가(예약 포함).
 * 큐 시작을 막는 판정에 쓴다 — 큐 자신의 런은 queue_id가 있어 제외된다.
 */
export function activeStandaloneRunForBaseUrl(
  baseUrl: string,
): { run_id: string | null; model_id: string | null } | null {
  for (const [runId, entry] of registry) {
    if (entry.info.base_url === baseUrl && !entry.info.queue_id) {
      return { run_id: runId, model_id: entry.info.model_id };
    }
  }
  for (const reserved of streamReservations.values()) {
    if (reserved === baseUrl) return { run_id: null, model_id: null };
  }
  return null;
}

export type LiveRunSummary = LiveRunInfo & { run_id: string; paused: boolean };

export function listLiveRuns(): LiveRunSummary[] {
  return [...registry.entries()].map(([run_id, entry]) => ({
    run_id,
    ...entry.info,
    paused: entry.paused,
  }));
}

/** 테스트 전용 — 모듈 레벨 Map을 초기화. */
export function _resetLiveRunRegistryForTests(): void {
  registry.clear();
  streamReservations.clear();
}
