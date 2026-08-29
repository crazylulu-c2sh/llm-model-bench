import { useEffect, useState } from "react";
import { useI18n } from "../i18n";

type HealthBody = {
  ok?: boolean;
  wsl_windows_host?: string | null;
};

function toLoopbackKeepingPort(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    const host = u.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return null;
    u.hostname = "127.0.0.1";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function WslLoopbackHint({
  baseUrl,
  onUseLocalhost,
}: {
  baseUrl: string;
  onUseLocalhost: (next: string) => void;
}) {
  const { m } = useI18n();
  const [host, setHost] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: HealthBody | null) => {
        if (cancelled) return;
        const ip = typeof j?.wsl_windows_host === "string" ? j.wsl_windows_host.trim() : "";
        setHost(ip || null);
      })
      .catch(() => {
        if (!cancelled) setHost(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!host) return null;

  const localhostUrl = toLoopbackKeepingPort(baseUrl);

  return (
    <p className="mt-2 text-xs leading-snug text-[var(--muted)]">
      {m.common.wslLoopbackHintBefore}
      <code className="rounded bg-[var(--surface)] px-1 font-mono text-[var(--foreground)]">{host}</code>
      {m.common.wslLoopbackHintAfter}
      {localhostUrl ? (
        <>
          {" "}
          <button
            type="button"
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-medium text-[var(--foreground)] hover:border-[var(--border-input)]"
            onClick={() => onUseLocalhost(localhostUrl)}
            aria-label={m.common.wslUseLocalhostAria(localhostUrl)}
          >
            {m.common.wslUseLocalhost}
          </button>
        </>
      ) : null}
    </p>
  );
}
