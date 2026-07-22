import { useMemo, useState } from "react";
import { ArrowDown, ArrowDownUp, ArrowUp } from "lucide-react";
import {
  AGENT_METRIC_COLUMNS,
  DEFAULT_AGENT_SORT,
  agentMetricValue,
  naturalAgentDir,
  sameAgentSortKey,
  sortAgentMetrics,
  type AgentMetricMeta,
  type AgentSort,
  type AgentSortKey,
  type ModelRouteAgentMetrics,
  type SortDir,
} from "../lib/agent-metrics";
import { BAND_COLOR, qualityBand, type ScoreBand } from "../lib/score-bands";
import { useI18n } from "../i18n";

function routeLabel(api: string): string {
  if (api === "chat_completions") return "chat";
  if (api === "messages") return "messages";
  return api;
}

function formatValue(v: number | null, col: AgentMetricMeta): string {
  if (v == null) return "—";
  if (col.format === "pct") return `${(v * 100).toFixed(0)}%`;
  if (col.format === "ms") return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** 색: 비율 지표만 밴드 색칠(방향 반영). ms·턴 등 절대량은 중립(색 없음). */
function bandFor(v: number | null, col: AgentMetricMeta): ScoreBand | undefined {
  if (v == null || col.format !== "pct") return undefined;
  // higher=클수록 좋음 → 그대로; lower=작을수록 좋음 → 1-v 로 밴드.
  const good = col.dir === "higher" ? v : 1 - v;
  return qualityBand(good * 100);
}

function sortDirIcon(active: boolean, dir: SortDir) {
  if (!active) return <ArrowDownUp className="size-3.5 shrink-0 opacity-45" aria-hidden />;
  return dir === "asc" ? (
    <ArrowUp className="size-3.5 shrink-0 opacity-90" aria-hidden />
  ) : (
    <ArrowDown className="size-3.5 shrink-0 opacity-90" aria-hidden />
  );
}

function AgentSortHeader({
  label,
  title,
  thClassName,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  title?: string;
  thClassName: string;
  sortKey: AgentSortKey;
  sort: AgentSort;
  onSort: (key: AgentSortKey) => void;
}) {
  const active = sameAgentSortKey(sort.key, sortKey);
  const ariaSort: "ascending" | "descending" | "none" = active
    ? sort.dir === "asc"
      ? "ascending"
      : "descending"
    : "none";
  return (
    <th scope="col" className={thClassName} title={title} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        {label}
        {sortDirIcon(active, sort.dir)}
      </button>
    </th>
  );
}

/** #105: 모델 × 라우트 에이전트 능력 지표 표(정렬 가능). raw TPS 역전을 드러낸다. */
export function AgentMetricsTable({ metrics }: { metrics: readonly ModelRouteAgentMetrics[] }) {
  const { m } = useI18n();
  const [sort, setSort] = useState<AgentSort>(DEFAULT_AGENT_SORT);
  const sorted = useMemo(() => sortAgentMetrics(metrics, sort), [metrics, sort]);

  function onSort(key: AgentSortKey) {
    setSort((prev) =>
      sameAgentSortKey(prev.key, key)
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: naturalAgentDir(key) },
    );
  }

  if (metrics.length === 0) {
    return (
      <p className="rounded border border-dashed border-[var(--border)] px-3 py-10 text-center text-xs text-[var(--muted)]">
        {m.monitor.agentEmptyState}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-[var(--border)]">
      <table className="w-full min-w-[72rem] text-left text-sm">
        <caption className="sr-only">{m.monitor.agentTableCaption}</caption>
        <thead className="bg-[var(--surface)] text-[var(--muted)]">
          <tr>
            <AgentSortHeader label={m.monitor.colModel} thClassName="p-2 font-medium" sortKey={{ kind: "model" }} sort={sort} onSort={onSort} />
            <AgentSortHeader label={m.monitor.colRoute} thClassName="p-2 font-medium" sortKey={{ kind: "route" }} sort={sort} onSort={onSort} />
            {AGENT_METRIC_COLUMNS.map((col) => (
              <AgentSortHeader
                key={col.metric}
                label={m.monitor.agentMetricLabel[col.metric]}
                title={m.monitor.agentMetricTitle[col.metric]}
                thClassName="p-2 text-right font-medium"
                sortKey={{ kind: "metric", metric: col.metric }}
                sort={sort}
                onSort={onSort}
              />
            ))}
            <th scope="col" className="p-2 text-right font-medium" title={m.monitor.nColTitleAgent}>
              n
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={`${row.model_id} ${row.api_route}`} className="border-t border-[var(--border)] align-middle">
              <td className="p-2 font-mono text-xs">{row.model_id}</td>
              <td className="p-2 text-xs text-[var(--muted)]">{routeLabel(row.api_route)}</td>
              {AGENT_METRIC_COLUMNS.map((col) => {
                const v = agentMetricValue(row, col.metric);
                const band = bandFor(v, col);
                return (
                  <td
                    key={col.metric}
                    className="p-2 text-right font-mono text-xs"
                    title={band ? m.monitor.bandLabel[band] : undefined}
                    style={{ color: band ? BAND_COLOR[band] : undefined }}
                  >
                    {formatValue(v, col)}
                  </td>
                );
              })}
              <td className="p-2 text-right font-mono text-xs text-[var(--muted)]">{row.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
