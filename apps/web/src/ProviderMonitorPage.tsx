import { useEffect, useMemo, useRef, useState } from "react";
import type { LmsAvailability, MonitorSnapshotResponse } from "@llm-bench/shared";
import { usePollingFetch } from "./lib/monitor-polling";
import {
  readInitialMonitorState,
  readSessionApiKey,
  saveMonitorSnapshot,
  SESSION_API_KEY,
  writeSessionApiKey,
  type MonitorProvider,
} from "./persisted-settings";

const INTERVAL_OPTIONS: { ms: 2000 | 5000 | 10000; label: string }[] = [
  { ms: 2000, label: "2초" },
  { ms: 5000, label: "5초" },
  { ms: 10000, label: "10초" },
];

const CARD_CLASS =
  "rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm";

function fmtMiB(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  return `${(bytes / 1024 / 1024).toFixed(0)} MiB`;
}

function fmtGiB(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

export function ProviderMonitorPage() {
  const [boot] = useState(() => readInitialMonitorState());
  const [baseUrl, setBaseUrl] = useState(boot.baseUrl);
  const [provider, setProvider] = useState<MonitorProvider>(boot.provider);
  const [pollEnabled, setPollEnabled] = useState(boot.pollEnabled);
  const [intervalMs, setIntervalMs] = useState<2000 | 5000 | 10000>(boot.intervalMs);
  const [apiKey, setApiKey] = useState<string>(() => readSessionApiKey());

  useEffect(() => {
    saveMonitorSnapshot({ baseUrl, provider, pollEnabled, intervalMs });
  }, [baseUrl, provider, pollEnabled, intervalMs]);

  useEffect(() => {
    writeSessionApiKey(apiKey);
  }, [apiKey]);

  // 다른 탭에서 SESSION_API_KEY 변경 시 동기화.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_API_KEY) setApiKey(e.newValue ?? "");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // 같은 탭에서 다른 SPA 라우트가 키를 바꿨다가 모니터로 돌아왔을 때 재읽기.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const v = readSessionApiKey();
      setApiKey((cur) => (cur !== v ? v : cur));
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const snapshotInit = useMemo<RequestInit>(
    () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl, provider, apiKey: apiKey || undefined }),
    }),
    [baseUrl, provider, apiKey],
  );

  const snap = usePollingFetch<MonitorSnapshotResponse>(
    "/api/monitor/snapshot",
    snapshotInit,
    intervalMs,
    pollEnabled,
  );

  const avail = usePollingFetch<LmsAvailability>(
    "/api/monitor/lms/availability",
    null,
    30_000,
    true,
  );

  const isLm = provider === "lm_studio";
  const cliReady = avail.data?.enabled && avail.data?.binary?.ok;
  const isLocal = snap.data?.localhost ?? false;
  const remoteLoopback = snap.data?.remoteLoopback ?? false;
  const cardEligible = isLm && cliReady && isLocal && remoteLoopback;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4">
      <section className={CARD_CLASS}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-1 flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">Base URL</span>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 font-mono text-sm"
              placeholder="http://127.0.0.1:1234"
              spellCheck={false}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">Provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as MonitorProvider)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
            >
              <option value="lm_studio">LM Studio</option>
              <option value="ollama">Ollama</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs sm:min-w-[14rem] flex-1">
            <span className="text-[var(--muted)]">API Key (선택, 세션 한정)</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 font-mono text-sm"
              placeholder="필요한 경우 입력"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={pollEnabled}
              onChange={(e) => setPollEnabled(e.target.checked)}
            />
            <span>폴링</span>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--muted)]">주기</span>
            <select
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value) as 2000 | 5000 | 10000)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
            >
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.ms} value={o.ms}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => snap.reload()}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]"
          >
            새로고침
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <Badge ok={remoteLoopback} label={remoteLoopback ? "loopback" : "remote"} />
          <Badge ok={isLocal} label={isLocal ? "localhost baseUrl" : "non-localhost baseUrl"} />
          <Badge
            ok={!!avail.data?.enabled}
            label={avail.data?.enabled ? "lms cli on" : "lms cli off"}
          />
          {snap.lastFetchedAt ? (
            <span>last: {new Date(snap.lastFetchedAt).toLocaleTimeString()}</span>
          ) : null}
          {snap.error ? <span className="text-red-500">{snap.error}</span> : null}
        </div>
      </section>

      {!remoteLoopback && snap.data ? (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--muted)]">
          이 환경에서는 클라이언트 IP가 loopback이 아니므로 <strong>system/gpu/CLI 카드가 비활성</strong>입니다 —
          provider HTTP 정보만 표시됩니다. (Docker Compose의 nginx 경유, 원격 브라우저 등) — README 의
          “Provider 모니터링 · lms CLI” 단락을 참고하세요.
        </div>
      ) : null}

      {!isLocal && snap.data ? (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--muted)]">
          baseUrl 이 localhost 가 아니므로 system/gpu 정보는 비활성입니다. baseUrl 을
          <code className="font-mono"> http://127.0.0.1:1234</code> 등으로 두고 사용해 주세요.
        </div>
      ) : null}

      <section className={CARD_CLASS}>
        <h2 className="mb-2 text-sm font-semibold">시스템 자원</h2>
        {snap.data?.system ? (
          <SystemCard data={snap.data.system} gpu={snap.data.gpu} />
        ) : (
          <p className="text-xs text-[var(--muted)]">비활성 — {snap.data?.reason ?? "데이터 없음"}</p>
        )}
      </section>

      <section className={CARD_CLASS}>
        <h2 className="mb-2 text-sm font-semibold">로드된 모델 ({snap.data?.provider.loaded.length ?? 0})</h2>
        <LoadedModelsTable data={snap.data} />
      </section>

      {cardEligible ? (
        <LmsControlCard
          baseUrl={baseUrl}
          loaded={snap.data?.provider.loaded ?? []}
          onSuccess={() => snap.reload()}
        />
      ) : null}

      {cardEligible ? <LmsLogStreamCard baseUrl={baseUrl} /> : null}
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 ${
        ok
          ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-300"
          : "border-amber-500/40 text-amber-700 dark:text-amber-300"
      }`}
    >
      {label}
    </span>
  );
}

function SystemCard({
  data,
  gpu,
}: {
  data: NonNullable<MonitorSnapshotResponse["system"]>;
  gpu: MonitorSnapshotResponse["gpu"];
}) {
  const used = data.totalMemBytes - data.freeMemBytes;
  const usedPct = data.totalMemBytes > 0 ? (used / data.totalMemBytes) * 100 : 0;
  return (
    <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
      <div>
        <div className="text-[var(--muted)]">메모리</div>
        <div className="font-mono">
          {fmtGiB(used)} / {fmtGiB(data.totalMemBytes)} ({usedPct.toFixed(1)}%)
        </div>
        <div className="mt-1 text-[var(--muted)]">CPU loadavg ({data.cpuCount} cores)</div>
        <div className="font-mono">{data.loadavg.map((x) => x.toFixed(2)).join("  ")}</div>
        <div className="mt-1 text-[var(--muted)]">platform: {data.platform}</div>
      </div>
      <div>
        <div className="text-[var(--muted)]">GPU</div>
        {!gpu || !gpu.available ? (
          <div className="font-mono text-[var(--muted)]">
            {gpu?.error ? `unavailable — ${truncate(gpu.error, 80)}` : "unavailable"}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {gpu.devices.map((d) => (
              <div key={d.index} className="font-mono">
                #{d.index} {d.name} — {d.memoryUsedMiB.toFixed(0)} / {d.memoryTotalMiB.toFixed(0)} MiB ·{" "}
                {d.utilizationPct}% util
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LoadedModelsTable({ data }: { data: MonitorSnapshotResponse | null }) {
  const loaded = data?.provider.loaded ?? [];
  if (data && data.provider.http && data.provider.http.ok === false) {
    return (
      <div className="text-xs text-[var(--muted)]">
        provider HTTP 호출 실패 — {data.provider.http.status ?? "?"} {truncate(data.provider.http.error ?? "", 200)}
      </div>
    );
  }
  if (loaded.length === 0) {
    return <p className="text-xs text-[var(--muted)]">로드된 모델 없음</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-xs">
        <thead className="border-b border-[var(--border)] text-[var(--muted)]">
          <tr>
            <th className="px-2 py-1">id</th>
            <th className="px-2 py-1">name</th>
            <th className="px-2 py-1">VRAM</th>
            <th className="px-2 py-1">RAM</th>
            <th className="px-2 py-1">size</th>
            <th className="px-2 py-1">ctx</th>
          </tr>
        </thead>
        <tbody>
          {loaded.map((m) => (
            <tr key={m.id} className="border-b border-[var(--border)]">
              <td className="px-2 py-1 font-mono">{m.id}</td>
              <td className="px-2 py-1 font-mono">{m.name ?? "—"}</td>
              <td className="px-2 py-1 font-mono">{fmtMiB(m.vramBytes)}</td>
              <td className="px-2 py-1 font-mono">{fmtMiB(m.ramBytes)}</td>
              <td className="px-2 py-1 font-mono">{fmtGiB(m.sizeBytes)}</td>
              <td className="px-2 py-1 font-mono">{m.contextLength ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LmsControlCard({
  baseUrl,
  loaded,
  onSuccess,
}: {
  baseUrl: string;
  loaded: MonitorSnapshotResponse["provider"]["loaded"];
  onSuccess?: () => void;
}) {
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function call(action: "load" | "unload", id: string): Promise<void> {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch(`/api/monitor/lms/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl, model: id }),
      });
      const j = (await r.json()) as { ok?: boolean; stdout?: string; error?: string };
      if (!r.ok || j.ok === false) {
        setResult(`${action} 실패: ${j.error ?? r.statusText}`);
      } else {
        setResult(`${action} OK${j.stdout ? `: ${truncate(j.stdout, 200)}` : ""}`);
        // 다음 폴링 사이클(최대 10s)까지 기다리지 않고 즉시 snapshot 갱신.
        onSuccess?.();
      }
    } catch (e) {
      setResult(`${action} 오류: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD_CLASS}>
      <h2 className="mb-2 text-sm font-semibold">모델 로드/언로드 (LM Studio CLI)</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span className="text-[var(--muted)]">모델 ID (예: publisher/model)</span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 font-mono text-sm"
            spellCheck={false}
            placeholder="LM Studio가 인식하는 모델 식별자"
          />
        </label>
        <button
          type="button"
          disabled={busy || !model.trim()}
          onClick={() => call("load", model.trim())}
          className="rounded-md border border-[var(--border)] bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {busy ? "처리 중…" : "load"}
        </button>
      </div>
      {result ? <p className="mt-2 text-xs">{result}</p> : null}
      {loaded.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {loaded.map((m) => {
            // HTTP 경로: id=loaded_instance.id, name=model key.
            // CLI 경로: id=model key. `lms unload`는 모델 식별자(key)를 기대하므로 name 우선.
            const cliTarget = m.name ?? m.id;
            return (
              <button
                key={m.id}
                type="button"
                disabled={busy}
                onClick={() => call("unload", cliTarget)}
                className="rounded-md border border-[var(--border)] px-2 py-1 hover:bg-[var(--surface)] disabled:opacity-50"
              >
                unload {cliTarget}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

const LOG_LINE_CAP = 500;

function LmsLogStreamCard({ baseUrl }: { baseUrl: string }) {
  const [active, setActive] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!active) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }
    const url = `/api/monitor/lms/log-stream?baseUrl=${encodeURIComponent(baseUrl)}`;
    const es = new EventSource(url);
    esRef.current = es;
    setError(null);
    es.onmessage = (ev) => {
      try {
        const j = JSON.parse(ev.data) as {
          type: string;
          stream?: string;
          line?: string;
          message?: string;
        };
        if (j.type === "line" && j.line) {
          const prefix = j.stream === "stderr" ? "[err] " : "";
          setLines((prev) => {
            const next = prev.concat(prefix + j.line);
            return next.length > LOG_LINE_CAP ? next.slice(next.length - LOG_LINE_CAP) : next;
          });
        } else if (j.type === "error" && j.message) {
          setError(j.message);
        }
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      // EventSource는 status code를 노출하지 않으므로 409·502 등을 정확히 구분할 수 없다.
      // 흔한 원인 2가지 안내.
      setError("연결 종료 또는 오류 (다른 클라이언트가 사용 중이거나 lms 프로세스 종료)");
      es.close();
      setActive(false);
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [active, baseUrl]);

  return (
    <section className={CARD_CLASS}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">lms server 로그 스트림</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActive((v) => !v)}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs hover:bg-[var(--surface-2)]"
          >
            {active ? "중지" : "시작"}
          </button>
          <button
            type="button"
            onClick={() => setLines([])}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs hover:bg-[var(--surface-2)]"
          >
            지우기
          </button>
        </div>
      </div>
      {error ? <p className="mb-2 text-xs text-red-500">{error}</p> : null}
      <pre className="max-h-96 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-[10px] font-mono leading-tight">
        {lines.length === 0 ? "라인 없음" : lines.join("\n")}
      </pre>
      <p className="mt-1 text-[10px] text-[var(--muted)]">
        최대 {LOG_LINE_CAP}라인. 서버는 1:1 lock — 다른 클라이언트가 이미 받고 있으면 409.
      </p>
    </section>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
