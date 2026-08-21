import { EventEmitter } from "node:events";
import type { StreamEvent } from "@llm-bench/shared";

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
};

type LiveEntry = {
  emitter: EventEmitter;
  info: LiveRunInfo;
  paused: boolean;
  /** token_delta 제외, 최대 MAX_BUFFERED_EVENTS개 — 재연결 시 그대로 replay. */
  buffered: StreamEvent[];
};

const MAX_BUFFERED_EVENTS = 500;

const registry = new Map<string, LiveEntry>();

export function startLiveRun(runId: string, info: LiveRunInfo): void {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // 여러 탭이 동시에 재연결할 수 있어 무제한 허용
  registry.set(runId, { emitter, info, paused: false, buffered: [] });
}

export function publishLiveEvent(runId: string, ev: StreamEvent): void {
  const entry = registry.get(runId);
  if (!entry) return;
  if (ev.type === "run_paused") entry.paused = true;
  if (ev.type === "run_resumed") entry.paused = false;
  if (ev.type !== "token_delta") {
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
    bufferedEvents: [...entry.buffered],
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
}
