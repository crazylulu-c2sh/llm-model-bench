import type { StressStageResult, StressTpsSource } from "@llm-bench/shared";

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function sourceLabel(s: StressTpsSource): string {
  if (s === "usage") return "usage";
  if (s === "mixed") return "mixed";
  return "approx";
}

export function StressResultTable({ stages, expectedScript }: { stages: StressStageResult[]; expectedScript: "ko" | "ja" | "latin" }) {
  const hasApproxAnywhere = stages.some((s) => s.tps_source !== "usage");
  const allApprox = stages.length > 0 && stages.every((s) => s.tps_source === "approx");
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-[var(--foreground)]">단계별 결과</h2>
      <table className="min-w-full text-left text-xs">
        <thead className="border-b border-[var(--border)] text-[var(--muted)]">
          <tr>
            <th className="px-2 py-1">동시성</th>
            <th className="px-2 py-1">TPS</th>
            <th className="px-2 py-1">TPS/사용자</th>
            <th className="px-2 py-1">성공률</th>
            <th className="px-2 py-1">p50</th>
            <th className="px-2 py-1">p95</th>
            <th className="px-2 py-1">에러율</th>
            <th className="px-2 py-1">enqueue/drain (ms)</th>
            <th className="px-2 py-1">source</th>
            {expectedScript !== "latin" ? <th className="px-2 py-1">예상 응답률({expectedScript})</th> : null}
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => {
            const successRate =
              s.requests_attempted > 0 ? s.requests_succeeded / s.requests_attempted : 0;
            return (
              <tr key={s.stage_index} className="border-b border-[var(--border)] text-[var(--foreground)]">
                <td className="px-2 py-1 font-mono">{s.concurrency}</td>
                <td className="px-2 py-1 font-mono">
                  {s.tps_unreliable ? <span title="신뢰도 낮음">{fmt(s.aggregate_tps, 1) ?? "—"}*</span> : fmt(s.aggregate_tps, 1)}
                </td>
                <td className="px-2 py-1 font-mono">{fmt(s.tps_per_user, 2)}</td>
                <td className="px-2 py-1 font-mono">{(successRate * 100).toFixed(0)}%</td>
                <td className="px-2 py-1 font-mono">{s.latency_ms.p50 ?? "—"}</td>
                <td className="px-2 py-1 font-mono">{s.latency_ms.p95 ?? "—"}</td>
                <td className="px-2 py-1 font-mono">{(s.error_rate * 100).toFixed(0)}%</td>
                <td className="px-2 py-1 font-mono">{s.enqueue_duration_ms} / {s.drain_ms}</td>
                <td className="px-2 py-1 font-mono">{sourceLabel(s.tps_source)}</td>
                {expectedScript !== "latin" ? (
                  <td className="px-2 py-1 font-mono">
                    {s.script_match_rate != null ? `${Math.round(s.script_match_rate * 100)}%` : "—"}
                  </td>
                ) : null}
              </tr>
            );
          })}
          {stages.length === 0 ? (
            <tr>
              <td className="px-2 py-2 text-[var(--muted)]" colSpan={expectedScript !== "latin" ? 10 : 9}>
                아직 결과가 없습니다.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {hasApproxAnywhere ? (
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
          {allApprox
            ? "이 런은 provider가 usage 토큰 수를 보고하지 않아 모든 단계에서 chars/4 추정치(approx)로 TPS를 계산했습니다. CJK 응답은 토큰당 글자 수가 적어 과소 추정 오차가 큽니다."
            : (
              <>
                일부 단계가 <code className="font-mono">approx</code>(또는 <code className="font-mono">mixed</code>)로 떨어졌습니다 — provider가 해당 요청에서 usage를 보내지 않았거나 <code className="font-mono">stream_options.include_usage</code>를 거부한 경우입니다. approx 단계의 TPS는 chars/4 추정치이며 CJK 응답에서 오차가 큽니다.
              </>
            )}
        </p>
      ) : null}
    </div>
  );
}
