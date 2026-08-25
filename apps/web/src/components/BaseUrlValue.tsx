import type { BaseUrlAlias } from "../lib/base-url-names";

/**
 * Base URL 표시 — 별칭 있으면 1줄=이름(+기기/스펙 메모), 2줄=원본 URL(mono·truncate).
 * 별칭 없으면 기존과 동일하게 원본 URL만. title에 전체 값 제공.
 */
export function BaseUrlValue({ baseUrl, alias }: { baseUrl: string; alias?: BaseUrlAlias }) {
  const named = !!alias && alias.name.trim() !== "";
  if (!named) {
    return (
      <span className="block max-w-[14rem] break-all font-mono text-[10px] text-[var(--muted)]" title={baseUrl}>
        {baseUrl}
      </span>
    );
  }
  const note = alias.note?.trim();
  return (
    <span className="block max-w-[14rem]" title={note ? `${baseUrl} — ${note}` : baseUrl}>
      <span className="flex items-baseline gap-1">
        <span className="shrink-0 text-xs font-medium">{alias.name}</span>
        {note ? (
          <span className="min-w-0 truncate text-[10px] text-[var(--muted)]" title={note}>
            {note}
          </span>
        ) : null}
      </span>
      <span className="block truncate font-mono text-[10px] text-[var(--muted)]">{baseUrl}</span>
    </span>
  );
}
