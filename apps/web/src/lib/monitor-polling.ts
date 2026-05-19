import { useEffect, useState } from "react";

export type PollingState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  lastFetchedAt: number | null;
};

export type PollingResult<T> = PollingState<T> & { reload: () => void };

const MIN_INTERVAL_MS = 1000;

export type FetchPollingResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; aborted?: boolean };

/**
 * 핵심 fetch 로직 — JSON 파싱·에러 형식 통일. hook과 별도로 export하여 테스트 가능.
 * AbortError는 `{ ok:false, error:"aborted", aborted:true }`로 통일.
 */
export async function fetchPollingJson<T>(
  url: string,
  init: RequestInit | null,
  signal: AbortSignal,
): Promise<FetchPollingResult<T>> {
  try {
    const r = await fetch(url, { ...(init ?? {}), signal });
    const text = await r.text();
    if (!r.ok) {
      return { ok: false, error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
    }
    try {
      return { ok: true, data: JSON.parse(text) as T };
    } catch (e) {
      return { ok: false, error: `invalid_json: ${(e as Error).message}` };
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      return { ok: false, error: "aborted", aborted: true };
    }
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * 폴링 fetch hook.
 * - dep: url/intervalMs/enabled/init 변경 시 재시작
 * - cleanup 시 in-flight AbortController abort + interval 제거
 * - enabled=false면 fetch 0회
 * - 일시 오류 시 직전 data는 유지 (stale-while-error) — UI 깜빡임 방지
 * - AbortError는 setState 자체를 skip — 정상 동작 중 빨간 메시지 노출 방지
 */
export function usePollingFetch<T>(
  url: string,
  init: RequestInit | null,
  intervalMs: number,
  enabled: boolean,
): PollingResult<T> {
  const [state, setState] = useState<PollingState<T>>({
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
  });
  const [reloadTick, setReloadTick] = useState(0);

  const initKey = init ? JSON.stringify(init) : "";

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let abort = new AbortController();

    const tick = async () => {
      abort.abort();
      abort = new AbortController();
      setState((s) => ({ ...s, loading: true }));
      const r = await fetchPollingJson<T>(url, init, abort.signal);
      if (cancelled) return;
      if (r.ok) {
        setState({ data: r.data, error: null, loading: false, lastFetchedAt: Date.now() });
      } else if (r.aborted) {
        // 사용자/cleanup이 끊은 것 — 직전 상태 유지.
        return;
      } else {
        setState((s) => ({
          data: s.data,
          error: r.error,
          loading: false,
          lastFetchedAt: Date.now(),
        }));
      }
    };

    void tick();
    const id = window.setInterval(tick, Math.max(MIN_INTERVAL_MS, intervalMs));
    return () => {
      cancelled = true;
      window.clearInterval(id);
      abort.abort();
    };
  }, [url, intervalMs, enabled, initKey, reloadTick]);

  return {
    ...state,
    reload: () => setReloadTick((n) => n + 1),
  };
}
