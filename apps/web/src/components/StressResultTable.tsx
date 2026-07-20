import type { StressStageResult, StressTpsSource } from "@llm-bench/shared";
import { getTpsTier, tpsTierColor, TPS_TIER_LABEL_KO, TPS_TIER_THRESHOLDS } from "../lib/tps-tier";

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function sourceLabel(s: StressTpsSource): string {
  if (s === "usage") return "usage";
  if (s === "mixed") return "mixed";
  return "approx";
}

const PER_USER_HEADER_TITLE = `색: 쾌적 ≥${TPS_TIER_THRESHOLDS.fast} · 쓸만 ${TPS_TIER_THRESHOLDS.good}–${TPS_TIER_THRESHOLDS.fast - 1} · 채택가능 ${TPS_TIER_THRESHOLDS.okay}–${TPS_TIER_THRESHOLDS.good - 1} · 너무 느림 <${TPS_TIER_THRESHOLDS.okay}`;

export function StressResultTable({ stages, expectedScript }: { stages: StressStageResult[]; expectedScript: "ko" | "ja" | "latin" }) {
  const hasApproxAnywhere = stages.some((s) => s.tps_source !== "usage");
  const allApprox = stages.length > 0 && stages.every((s) => s.tps_source === "approx");
  const hasUnreliableAnywhere = stages.some((s) => s.tps_unreliable === true);
  const hasTtftAnywhere = stages.some((s) => s.ttft_ms != null);
  const emptyColSpan = 9 + (expectedScript !== "latin" ? 1 : 0) + (hasTtftAnywhere ? 2 : 0);
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-[var(--foreground)]">단계별 결과</h2>
      <table className="min-w-full text-left text-xs">
        <caption className="sr-only">동시성 단계별 스트레스 벤치 결과</caption>
        <thead className="border-b border-[var(--border)] text-[var(--muted)]">
          <tr>
            <th scope="col" className="px-2 py-1">동시성</th>
            <th scope="col" className="px-2 py-1">TPS</th>
            <th scope="col" className="px-2 py-1" title={PER_USER_HEADER_TITLE}>TPS/사용자</th>
            <th scope="col" className="px-2 py-1">성공률</th>
            <th scope="col" className="px-2 py-1">{hasTtftAnywhere ? "총 p50" : "p50"}</th>
            <th scope="col" className="px-2 py-1">{hasTtftAnywhere ? "총 p95" : "p95"}</th>
            {hasTtftAnywhere ? (
              <>
                <th scope="col" className="px-2 py-1" title="Time To First Token (prefill·KV 캐시 지표)">TTFT p50</th>
                <th scope="col" className="px-2 py-1" title="Time To First Token (prefill·KV 캐시 지표)">TTFT p95</th>
              </>
            ) : null}
            <th scope="col" className="px-2 py-1">에러율</th>
            <th scope="col" className="px-2 py-1">enqueue/drain (ms)</th>
            <th scope="col" className="px-2 py-1">source</th>
            {expectedScript !== "latin" ? <th scope="col" className="px-2 py-1">예상 응답률({expectedScript})</th> : null}
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => {
            const successRate =
              s.requests_attempted > 0 ? s.requests_succeeded / s.requests_attempted : 0;
            const perUserTier = getTpsTier(s.tps_per_user, s.tps_unreliable === true);
            return (
              <tr key={s.stage_index} className="border-b border-[var(--border)] text-[var(--foreground)]">
                <td className="px-2 py-1 font-mono">{s.concurrency}</td>
                <td className="px-2 py-1 font-mono">
                  {s.tps_unreliable ? <span title="신뢰도 낮음">{fmt(s.aggregate_tps, 1) ?? "—"}*</span> : fmt(s.aggregate_tps, 1)}
                </td>
                <td
                  className="px-2 py-1 font-mono"
                  style={{ color: tpsTierColor(perUserTier) }}
                  title={perUserTier ? TPS_TIER_LABEL_KO[perUserTier] : undefined}
                >
                  {fmt(s.tps_per_user, 2)}
                  {perUserTier ? (
                    <span className="ml-1 text-[10px] text-[var(--muted)]">{TPS_TIER_LABEL_KO[perUserTier]}</span>
                  ) : null}
                </td>
                <td className="px-2 py-1 font-mono">{(successRate * 100).toFixed(0)}%</td>
                <td className="px-2 py-1 font-mono">{s.latency_ms.p50 ?? "—"}</td>
                <td className="px-2 py-1 font-mono">{s.latency_ms.p95 ?? "—"}</td>
                {hasTtftAnywhere ? (
                  <>
                    <td className="px-2 py-1 font-mono">{s.ttft_ms?.p50 ?? "—"}</td>
                    <td className="px-2 py-1 font-mono">{s.ttft_ms?.p95 ?? "—"}</td>
                  </>
                ) : null}
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
              <td className="px-2 py-2 text-[var(--muted)]" colSpan={emptyColSpan}>
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
      {hasUnreliableAnywhere ? (
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
          집계 TPS의 <code className="font-mono">*</code>(신뢰도 낮음 — 표본 부족·단계 너무 짧음·성공 없음) 단계는 TPS/사용자 셀이 회색(<code className="font-mono">—</code>)으로 표시됩니다.
        </p>
      ) : null}
    </div>
  );
}
