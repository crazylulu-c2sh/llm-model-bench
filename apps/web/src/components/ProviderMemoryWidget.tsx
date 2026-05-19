import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Cpu } from "lucide-react";
import type { MonitorSnapshotResponse, ProviderKind } from "@llm-bench/shared";
import { usePollingFetch } from "../lib/monitor-polling";

const CARD_CLASS =
  "rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm";

function fmtGiB(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

/**
 * Stress 페이지용 미니 위젯. `lm_studio`/`ollama` 외에는 미렌더(빈 응답만 받는 케이스 회피).
 * 폴링은 5초 fixed — 풀 페이지(/provider-monitor)에서 주기를 조절할 수 있다.
 */
export function ProviderMemoryWidget({
  baseUrl,
  provider,
  apiKey,
}: {
  baseUrl: string;
  provider: ProviderKind;
  apiKey?: string;
}) {
  const [open, setOpen] = useState(true);
  const eligible = provider === "lm_studio" || provider === "ollama";

  const init = useMemo<RequestInit>(
    () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl, provider, apiKey: apiKey || undefined }),
    }),
    [baseUrl, provider, apiKey],
  );

  // 접힌 상태에서는 폴링도 멈춤 — 화면 밖이라 데이터를 갱신할 이유 없음.
  const snap = usePollingFetch<MonitorSnapshotResponse>(
    "/api/monitor/snapshot",
    init,
    5000,
    eligible && open,
  );

  if (!eligible) return null;

  const sys = snap.data?.system;
  const loaded = snap.data?.provider.loaded ?? [];
  const disabledReason = !snap.data?.remoteLoopback
    ? "loopback이 아닌 환경 — 비활성"
    : !snap.data?.localhost
      ? "baseUrl이 localhost가 아님 — 비활성"
      : null;

  return (
    <section className={CARD_CLASS}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-semibold text-[var(--foreground)]"
      >
        <span className="inline-flex items-center gap-2">
          <Cpu className="size-4" aria-hidden />
          메모리 모니터
        </span>
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>
      {open ? (
        <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div>
            {sys ? (
              <>
                <div className="text-[var(--muted)]">시스템 RAM</div>
                <div className="font-mono">
                  {fmtGiB(sys.totalMemBytes - sys.freeMemBytes)} / {fmtGiB(sys.totalMemBytes)}
                </div>
                <div className="mt-1 text-[var(--muted)]">loadavg</div>
                <div className="font-mono">{sys.loadavg.map((x) => x.toFixed(2)).join(" / ")}</div>
              </>
            ) : (
              <div className="text-[var(--muted)]">{disabledReason ?? "데이터 없음"}</div>
            )}
          </div>
          <div>
            <div className="text-[var(--muted)]">로드된 모델 ({loaded.length})</div>
            {loaded.length === 0 ? (
              <div className="font-mono text-[var(--muted)]">—</div>
            ) : (
              <ul className="font-mono">
                {loaded.slice(0, 3).map((m) => (
                  <li key={m.id} className="truncate">
                    {m.name ?? m.id}
                  </li>
                ))}
                {loaded.length > 3 ? <li className="text-[var(--muted)]">… +{loaded.length - 3}</li> : null}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
