import { modelKey } from "@llm-bench/shared";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowDownUp, ArrowUp, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  DEFAULT_LEAK_SORT,
  isAgentSafe,
  leakMetricValue,
  naturalLeakDir,
  sameLeakSortKey,
  sortLeaks,
  type LeakMetric,
  type LeakSort,
  type LeakSortKey,
  type ModelRouteLeakMetrics,
  type SortDir,
} from "../lib/leak-metrics";
import { cycleKeyedSort } from "../lib/column-sort-cycle";
import { BAND_COLOR, leakBand } from "../lib/score-bands";
import { ModelLabel } from "./ModelLabel";
import { useI18n } from "../i18n";

const LEAK_METRICS: readonly LeakMetric[] = ["thinking_leak", "empty_turn", "channel_tag"];

function routeLabel(api: string): string {
  if (api === "chat_completions") return "chat";
  if (api === "messages") return "messages";
  return api;
}

function pct(value: number | null): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function sortDirIcon(active: boolean, dir: SortDir, isDefault: boolean) {
  if (!active || isDefault) return <ArrowDownUp className="size-3.5 shrink-0 opacity-45" aria-hidden />;
  return dir === "asc" ? (
    <ArrowUp className="size-3.5 shrink-0 opacity-90" aria-hidden />
  ) : (
    <ArrowDown className="size-3.5 shrink-0 opacity-90" aria-hidden />
  );
}

function LeakSortHeader({
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
  sortKey: LeakSortKey;
  sort: LeakSort;
  onSort: (key: LeakSortKey) => void;
}) {
  const active = sameLeakSortKey(sort.key, sortKey);
  const isDefault =
    sameLeakSortKey(sort.key, DEFAULT_LEAK_SORT.key) && sort.dir === DEFAULT_LEAK_SORT.dir;
  const ariaSort: "ascending" | "descending" | "none" =
    active && !isDefault
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
        {sortDirIcon(active, sort.dir, isDefault)}
      </button>
    </th>
  );
}

/** #80: 모델 × 라우트 누수/정체 지표 표(정렬 가능). 셋 다 낮으면 "agent-safe". */
export function LeakTable({ leaks }: { leaks: readonly ModelRouteLeakMetrics[] }) {
  const { m } = useI18n();
  // 아래 LEAK_METRICS.map 콜백이 지표 변수명 `m`으로 i18n `m`을 가리므로 라벨은 미리 캡처.
  const bandLabel = m.monitor.bandLabel;
  const leakLabel = m.monitor.leakMetricLabel;
  const leakTitle = m.monitor.leakMetricTitle;
  const [sort, setSort] = useState<LeakSort>(DEFAULT_LEAK_SORT);
  const sorted = useMemo(() => sortLeaks(leaks, sort), [leaks, sort]);

  function onSort(key: LeakSortKey) {
    setSort((prev) => cycleKeyedSort(prev, key, DEFAULT_LEAK_SORT, naturalLeakDir, sameLeakSortKey));
  }

  if (leaks.length === 0) {
    return (
      <p className="rounded border border-[var(--border)] p-4 text-xs text-[var(--muted)]">
        {m.monitor.leakEmptyState}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-[var(--border)]">
      <table className="w-full min-w-[38rem] text-left text-sm">
        <caption className="sr-only">{m.monitor.leakTableCaption}</caption>
        <thead className="bg-[var(--surface)] text-[var(--muted)]">
          <tr>
            <LeakSortHeader
              label={m.monitor.colModel}
              thClassName="p-2 font-medium"
              sortKey={{ kind: "model" }}
              sort={sort}
              onSort={onSort}
            />
            <LeakSortHeader
              label={m.monitor.colRoute}
              thClassName="p-2 font-medium"
              sortKey={{ kind: "route" }}
              sort={sort}
              onSort={onSort}
            />
            {LEAK_METRICS.map((m) => (
              <LeakSortHeader
                key={m}
                label={leakLabel[m]}
                title={leakTitle[m]}
                thClassName="p-2 text-right font-medium"
                sortKey={{ kind: "metric", metric: m }}
                sort={sort}
                onSort={onSort}
              />
            ))}
            <th scope="col" className="p-2 text-center font-medium" title={m.monitor.safeColTitle}>
              {m.monitor.safeCol}
            </th>
            <th scope="col" className="p-2 text-right font-medium" title={m.monitor.nColTitleLeak}>
              n
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const safe = isAgentSafe(row);
            return (
              <tr
                key={`${modelKey(row)} ${row.api_route}`}
                className="border-t border-[var(--border)] align-middle"
              >
                <td className="p-2 text-xs">
                  <ModelLabel modelId={row.model_id} comparisonId={row.comparison_id} size={14} className="max-w-[16rem]" />
                </td>
                <td className="p-2 text-xs text-[var(--muted)]">{routeLabel(row.api_route)}</td>
                {LEAK_METRICS.map((m) => {
                  const v = leakMetricValue(row, m);
                  const band = leakBand(v, m);
                  return (
                    <td key={m} className="p-2 text-right font-mono text-xs" title={bandLabel[band]} style={{ color: BAND_COLOR[band] }}>
                      {pct(v)}
                    </td>
                  );
                })}
                <td className="p-2 text-center">
                  {safe ? (
                    <span className="inline-flex items-center text-[var(--tier-fast)]" title="agent-safe">
                      <ShieldCheck className="size-4" aria-label="agent-safe" />
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-[var(--warning)]" title={m.monitor.leakWarningTitle}>
                      <ShieldAlert className="size-4" aria-label={m.monitor.warningAria} />
                    </span>
                  )}
                </td>
                <td className="p-2 text-right font-mono text-xs text-[var(--muted)]">{row.n}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
