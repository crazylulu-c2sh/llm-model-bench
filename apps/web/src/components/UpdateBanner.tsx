import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "../i18n";

type UpdateCheckResponse = {
  status?: string;
  localSha?: string;
  behindBy?: number;
  compareUrl?: string;
};

const FETCH_TIMEOUT_MS = 5_000;

function dismissKey(localSha: string): string {
  return `llm-bench:update-banner-dismissed:${localSha}`;
}

function shouldShow(data: UpdateCheckResponse): data is UpdateCheckResponse & {
  status: "behind" | "diverged";
  behindBy: number;
  localSha: string;
  compareUrl: string;
} {
  const behindBy = typeof data.behindBy === "number" ? data.behindBy : 0;
  if (behindBy <= 0) return false;
  if (data.status !== "behind" && data.status !== "diverged") return false;
  if (typeof data.localSha !== "string" || !data.localSha) return false;
  if (typeof data.compareUrl !== "string" || !data.compareUrl) return false;
  return true;
}

/**
 * 로컬 main이 GitHub main보다 뒤처졌을 때만 헤더 아래 warning 배너.
 * 오프라인·unavailable·fetch 실패는 조용히 무시(토스트 없음).
 */
export function UpdateBanner() {
  const { m } = useI18n();
  const [info, setInfo] = useState<{
    behindBy: number;
    localSha: string;
    compareUrl: string;
  } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

    void (async () => {
      try {
        const res = await fetch("/api/update-check", { signal: ac.signal });
        if (!res.ok) return;
        const data = (await res.json()) as UpdateCheckResponse;
        if (!shouldShow(data)) return;
        try {
          if (sessionStorage.getItem(dismissKey(data.localSha)) === "1") {
            setDismissed(true);
            return;
          }
        } catch {
          // sessionStorage 불가 — 배너는 표시
        }
        setInfo({
          behindBy: data.behindBy,
          localSha: data.localSha,
          compareUrl: data.compareUrl,
        });
      } catch {
        // 네트워크/타임아웃 — 배너 없음
      }
    })();

    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, []);

  if (!info || dismissed) return null;

  const ub = m.header.updateBanner;

  const onDismiss = () => {
    try {
      sessionStorage.setItem(dismissKey(info.localSha), "1");
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className="border-b border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-2.5 text-sm text-[var(--warning)] xl:px-6"
    >
      <div className="mx-auto flex max-w-6xl items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-medium leading-snug">{ub.title(info.behindBy)}</p>
          <p className="text-xs leading-snug opacity-90">{ub.hint}</p>
          <p className="text-xs leading-snug">
            <a
              className="underline underline-offset-2"
              href={info.compareUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={ub.compareLinkAria}
              title={ub.compareLinkAria}
            >
              {ub.compareLink}
              <span className="sr-only"> {ub.newWindowSuffix}</span>
            </a>
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-[var(--warning)] hover:bg-[var(--warning)]/15"
          onClick={onDismiss}
          aria-label={ub.dismissAria}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
