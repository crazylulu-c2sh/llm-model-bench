/** 밀리초를 "48s"·"2m 15s"·"1h 05m" 같은 짧은 소요 시간 문구로 포맷(로케일 무관, formatTimeWithMs와 같은 성격). */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function formatTimeWithMs(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** ISO 8601 문자열을 브라우저 로컬 타임존·UI 로케일로 초 단위 포맷. null/잘못된 입력은 "—". */
export function formatIsoLocal(iso: string | null | undefined, locale?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium", hour12: false }).format(d);
}

export function localTimeZoneName(locale?: string): string {
  return new Intl.DateTimeFormat(locale).resolvedOptions().timeZone || "local";
}
