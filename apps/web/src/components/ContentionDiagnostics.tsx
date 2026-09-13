import { ContentionObservationSchema } from "@llm-bench/shared";
import { useI18n } from "../i18n";
import { contentionReasonText } from "../lib/contention-diagnostics";

export function ContentionDiagnostics({ summary, runLabel }: { summary: unknown; runLabel?: string }) {
  const { m } = useI18n();
  if (!summary || typeof summary !== "object") return null;
  const raw = (summary as Record<string, unknown>).recent_observations;
  if (!Array.isArray(raw)) return null;
  const observations = raw.slice(-20).flatMap((v) => {
    const parsed = ContentionObservationSchema.safeParse(v);
    return parsed.success ? [parsed.data] : [];
  });
  if (!observations.length) return null;
  return <details className="my-2 rounded border border-[var(--border)] p-2 text-xs">
    <summary className="cursor-pointer">{runLabel ? `${runLabel} · ` : ""}{m.bench.guardDiagnosticsLabel}</summary>
    {typeof (summary as Record<string, unknown>).abort_reason === "string" && <p>{String((summary as Record<string, unknown>).abort_reason)}</p>}
    <ol className="mt-2 list-decimal space-y-2 pl-5">
      {observations.map((o, i) => <li key={i}>
        <span>{o.scenario_id ?? o.phase} · {o.api_route} · {(o.elapsed_ms / 1000).toFixed(1)}s · {contentionReasonText(o, m.bench.guardIdleConfirmed)}</span>
        <div>GPU: {o.gpu_util_pct ?? "?"}% / {o.gpu_threshold_pct}% · MTPLX: {o.mtplx_status}
          {o.mtplx && <> · outstanding={o.mtplx.outstanding} · pending={o.mtplx.pending} · keepalive={String(o.mtplx.keepalive_attentive ?? o.mtplx.keepalive_enabled)} · cancelled={o.mtplx.requests_cancelled ?? "?"}</>}
        </div>
        {o.preceding_failure && <div>{m.bench.guardPrecedingFailure}: {o.preceding_failure.scenario_id} · {o.preceding_failure.api_route} · {o.preceding_failure.code}</div>}
      </li>)}
    </ol>
  </details>;
}
