import { createContext, useContext } from "react";
import { useI18n } from "../i18n";

export type ComparisonPresentation = { modelId: string; server: string; config?: Record<string, unknown>; complete?: boolean; configId?: string };
export const ComparisonPresentationContext = createContext<Map<string, ComparisonPresentation>>(new Map());
export function useComparisonPresentation() { return useContext(ComparisonPresentationContext); }
export function settingsSummary(p: ComparisonPresentation): string {
  const c = p.config ?? {};
  const sampling = c.effective_sampling as Record<string, unknown> | null | undefined;
  return `${c.profile_thinking_intent ?? "—"} · ${c.reasoning_effort ?? "—"} · T=${sampling?.temperature ?? c.temperature ?? "—"} · max=${c.request_max_tokens ?? c.profile_max_tokens_override ?? c.max_tokens ?? "—"} · ${p.configId?.slice(3, 11) ?? "—"}`;
}
export function comparisonLabel(p: ComparisonPresentation): string {
  return `${p.modelId} · ${p.server} · ${settingsSummary(p)}`;
}
export function SettingsDetails({ presentation }: { presentation: ComparisonPresentation }) {
  const { m } = useI18n();
  return <details className="max-w-md text-xs text-[var(--muted)]">
    <summary className="cursor-pointer">{m.common.settings}: {settingsSummary(presentation)}</summary>
    {presentation.complete === false ? <p>{m.common.incompleteSettings}</p> : null}
    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(presentation.config ?? {}, null, 2)}</pre>
  </details>;
}
