/**
 * 실행 중인 벤치 런의 일시정지/재개/정지를 위한 모듈 레벨 레지스트리.
 * runId로 키잉되며, `runBench` 제너레이터(내부)와 `/bench/:runId/pause`·`/resume`·`/stop`
 * 라우트(외부, 별도 HTTP 요청)가 이 레지스트리를 통해 상태를 주고받는다.
 * Node는 단일 스레드이므로 아래 함수들 사이에 race condition은 없다.
 *
 * 정지는 HTTP 연결 종료(fetch abort/새로고침)에 얹지 않는다 — 벤치는 클라이언트 연결과
 * 무관하게 서버에서 끝까지 실행되는 것이 의도된 계약이므로, 정지는 이 레지스트리를 통한
 * 명시적 액션(`cancelRunControl`)으로만 발생한다.
 */

type RunControlEntry = {
  paused: boolean;
  cancelled: boolean;
  waiters: Array<() => void>;
  controller: AbortController;
};

const registry = new Map<string, RunControlEntry>();

/** 일시정지 중 아무도 재개하지 않을 때(탭 종료·슬립 등) 영원히 멈춰있지 않도록 하는 안전장치. */
const DEFAULT_PAUSE_MAX_WAIT_MS = 30 * 60 * 1000;

/** 런을 레지스트리에 등록하고, 정지 시그널로 쓸 AbortSignal을 반환한다. */
export function registerRunControl(runId: string): AbortSignal {
  const controller = new AbortController();
  registry.set(runId, { paused: false, cancelled: false, waiters: [], controller });
  return controller.signal;
}

export function unregisterRunControl(runId: string): void {
  registry.delete(runId);
}

export function pauseRunControl(runId: string): boolean {
  const entry = registry.get(runId);
  if (!entry || entry.cancelled) return false;
  entry.paused = true;
  return true;
}

export function resumeRunControl(runId: string): boolean {
  const entry = registry.get(runId);
  if (!entry) return false;
  entry.paused = false;
  const waiters = entry.waiters.splice(0);
  for (const wake of waiters) wake();
  return true;
}

export function cancelRunControl(runId: string): boolean {
  const entry = registry.get(runId);
  if (!entry) return false;
  entry.cancelled = true;
  entry.paused = false;
  entry.controller.abort();
  const waiters = entry.waiters.splice(0);
  for (const wake of waiters) wake();
  return true;
}

export function isRunPaused(runId: string): boolean {
  return registry.get(runId)?.paused ?? false;
}

export function isRunCancelled(runId: string): boolean {
  return registry.get(runId)?.cancelled ?? false;
}

/**
 * 현재 일시정지 상태가 아니면 즉시 resolve. 일시정지 중이면 `resumeRunControl` 또는
 * `cancelRunControl` 호출로 깨어날 때까지 대기하되, `maxWaitMs`를 넘기면 자동으로
 * 재개시켜(런은 계속 진행하게) 영구 정지를 방지한다.
 */
export function waitWhileRunPaused(
  runId: string,
  maxWaitMs: number = DEFAULT_PAUSE_MAX_WAIT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const entry = registry.get(runId);
    if (!entry || !entry.paused) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    entry.waiters.push(finish);
    const timer = setTimeout(() => {
      if (settled) return;
      resumeRunControl(runId);
    }, maxWaitMs);
  });
}

/** 테스트 전용 — 모듈 레벨 Map을 초기화해 테스트 간 레지스트리 누수를 막는다. */
export function _resetRunControlRegistryForTests(): void {
  registry.clear();
}
