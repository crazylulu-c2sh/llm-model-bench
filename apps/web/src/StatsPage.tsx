import type { SortingState } from "@tanstack/react-table";
import { Activity, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { BenchRunDetailResponse, StatsModelLatestItem, StatsModelLatestResponse } from "./api-types";
import { BenchCharts } from "./components/BenchCharts";
import { DEFAULT_STATS_MODEL_SORTING, StatsModelTable } from "./components/StatsModelTable";
import { scenarioRowKey, type ChartRow } from "./components/chart-types";
import { HighlightToggle } from "./components/JsonCodeBlock";
import type { ResultRow } from "./components/ResultsTable";
import { ResultsTable } from "./components/ResultsTable";
import { Scoreboard } from "./components/Scoreboard";
import { ProviderKindSchema, type ProviderKind } from "@llm-bench/shared";
import { ScenarioDetailDrawer, type ScenarioDetailPayload } from "./components/ScenarioDetailDrawer";
import { defaultScenarioPromptPreview, defaultScenarioSystemPromptPreview } from "./lib/scenario-prompt-preview";
import { compareModelIdAlphanumeric, compareModelKey, normalizeBaseUrl } from "./lib/model-sort";
import { buildChartRowsFromBenchState, mergeBenchDetailsToState, type MetricsAgg } from "./stats/hydrateBenchUi";
import { useI18n, msg } from "./i18n";

function statsItemHasResults(it: StatsModelLatestItem): boolean {
  return (it.scenario_count ?? 0) > 0;
}

/** StatsModelLatestItem.provider(string)를 ProviderKind로 코어션(미상→manual). */
function asProviderKind(p: string): ProviderKind {
  return ProviderKindSchema.safeParse(p).success ? (p as ProviderKind) : "manual";
}

export function StatsPage() {
  const { m } = useI18n();
  const [listItems, setListItems] = useState<StatsModelLatestItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [benchDetailsOk, setBenchDetailsOk] = useState<BenchRunDetailResponse[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPayload, setDrawerPayload] = useState<ScenarioDetailPayload | null>(null);
  const [hlPreview, setHlPreview] = useState(false);
  const [statsListSorting, setStatsListSorting] = useState<SortingState>(() => DEFAULT_STATS_MODEL_SORTING);
  const [sortedRunIdsFromTable, setSortedRunIdsFromTable] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setListLoading(true);
      try {
        const res = await fetch("/api/stats/model-latest");
        const j = (await res.json()) as StatsModelLatestResponse;
        if (cancelled) return;
        if (j.sqlite_available === false) {
          toast.warning(j.sqlite_error ?? msg().stats.sqliteUnavailable);
        }
        setListItems(j.items ?? []);
      } catch (e) {
        if (!cancelled) toast.error(String(e));
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedIds((prev) =>
      prev.filter((id) => {
        const it = listItems.find((x) => x.run_id === id);
        return it != null && statsItemHasResults(it);
      }),
    );
  }, [listItems]);

  useEffect(() => {
    setStatsListSorting(DEFAULT_STATS_MODEL_SORTING);
  }, [listItems]);

  const selectionKey = selectedIds.slice().sort().join("\0");

  useEffect(() => {
    if (!selectionKey) {
      setBenchDetailsOk([]);
      setDetailLoading(false);
      return;
    }
    const runIds = selectionKey.split("\0");
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      try {
        const results = await Promise.all(
          runIds.map(async (runId) => {
            const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
            if (!res.ok) return null;
            return (await res.json()) as BenchRunDetailResponse;
          }),
        );
        if (cancelled) return;
        const failed = results.filter((r) => r === null).length;
        if (failed > 0) {
          toast.warning(msg().stats.someRunsFailed(failed));
        }
        const ok = results.filter(
          (r): r is BenchRunDetailResponse => r != null && r.meta != null && Array.isArray(r.scenarios),
        );
        setBenchDetailsOk(ok);
      } catch (e) {
        if (!cancelled) toast.error(String(e));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectionKey]);

  const sortedBenchDetails = useMemo(() => {
    if (benchDetailsOk.length === 0) return [];
    const orderIndex = new Map(sortedRunIdsFromTable.map((id, i) => [id, i]));
    return [...benchDetailsOk].sort((a, b) => {
      const ra = String(a.meta.run_id);
      const rb = String(b.meta.run_id);
      const ia = orderIndex.get(ra);
      const ib = orderIndex.get(rb);
      if (ia != null && ib != null) return ia - ib;
      if (ia != null) return -1;
      if (ib != null) return 1;
      return compareModelKey(
        { model_id: String(a.meta.model_id), base_url: normalizeBaseUrl(String(a.meta.base_url)) },
        { model_id: String(b.meta.model_id), base_url: normalizeBaseUrl(String(b.meta.base_url)) },
      );
    });
  }, [benchDetailsOk, sortedRunIdsFromTable]);

  const { rows, detailAggregate, promptByRowKey, systemPromptByRowKey } = useMemo(() => {
    if (sortedBenchDetails.length === 0) {
      return {
        rows: [] as ResultRow[],
        detailAggregate: {} as Record<string, MetricsAgg>,
        promptByRowKey: {} as Record<string, string>,
        systemPromptByRowKey: {} as Record<string, string>,
      };
    }
    return mergeBenchDetailsToState(sortedBenchDetails);
  }, [sortedBenchDetails]);

  const chartRows = useMemo(
    () => buildChartRowsFromBenchState(rows, detailAggregate),
    [rows, detailAggregate],
  );

  const chartModelIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of chartRows) {
      if (r.modelId) s.add(r.modelId);
    }
    return [...s].sort(compareModelIdAlphanumeric);
  }, [chartRows]);

  const [chartModelFilter, setChartModelFilter] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setChartModelFilter((prev) => {
      const next: Record<string, boolean> = {};
      for (const id of chartModelIds) {
        next[id] = prev[id] === false ? false : true;
      }
      return next;
    });
  }, [chartModelIds.join("\0")]);

  const filteredChartRows = useMemo(
    () => chartRows.filter((r) => !r.modelId || chartModelFilter[r.modelId] !== false),
    [chartRows, chartModelFilter],
  );

  const selectedMap = useMemo(() => Object.fromEntries(selectedIds.map((id) => [id, true])), [selectedIds]);

  const selectableCount = useMemo(() => listItems.filter(statsItemHasResults).length, [listItems]);
  // model_id → 백엔드(스코어보드 벤더 아이콘 옆 배지·툴팁용). listItems가 이미 provider를 담고 있어 추가 fetch 없음.
  const providerByModel = useMemo(
    () => new Map(listItems.map((it) => [it.model_id, asProviderKind(it.provider)])),
    [listItems],
  );

  const canSelectStatsRow = useCallback((row: StatsModelLatestItem) => statsItemHasResults(row), []);

  const toggleRun = useCallback((runId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(runId)) return prev.filter((x) => x !== runId);
      const it = listItems.find((x) => x.run_id === runId);
      if (!it || !statsItemHasResults(it)) return prev;
      return [...prev, runId];
    });
  }, [listItems]);

  const handleSelectAllStats = useCallback(
    (next: boolean, runIds: string[]) => {
      setSelectedIds((prev) => {
        if (!next) {
          const remove = new Set(runIds);
          return prev.filter((id) => !remove.has(id));
        }
        const existing = new Set(prev);
        const additions = runIds.filter((id) => {
          if (existing.has(id)) return false;
          const it = listItems.find((x) => x.run_id === id);
          return it != null && statsItemHasResults(it);
        });
        return additions.length > 0 ? [...prev, ...additions] : prev;
      });
    },
    [listItems],
  );

  const openDrawerForRow = useCallback(
    (row: ResultRow) => {
      const agg = detailAggregate[row.rowKey];
      const runs = agg?.runs ?? [];
      const last = runs[runs.length - 1];
      const n = runs.length;
      setDrawerPayload({
        title: `${row.scenario} / ${row.api}`,
        scenario: row.scenario,
        api: row.api,
        modelId: row.model_id,
        ttft_ms: row.ttft_ms,
        pass: row.pass,
        score: row.score ?? last?.quality?.score,
        qualityReason: row.reason ?? last?.quality?.reason,
        systemPrompt:
          agg?.system_prompt ??
          systemPromptByRowKey[row.rowKey] ??
          defaultScenarioSystemPromptPreview(row.scenario),
        userPrompt:
          agg?.user_prompt ??
          promptByRowKey[row.rowKey] ??
          defaultScenarioPromptPreview(row.scenario),
        outputText: last?.output_text ?? "",
        measuredRunIndex: n > 0 ? n : undefined,
        measuredRunTotal: n > 0 ? n : undefined,
      });
      setDrawerOpen(true);
    },
    [detailAggregate, promptByRowKey, systemPromptByRowKey],
  );

  const openFromChartRow = useCallback(
    (row: ChartRow) => {
      const key = scenarioRowKey(row.scenario, row.api, row.modelId);
      const tableRow = rows.find((r) => r.rowKey === key);
      if (tableRow) {
        openDrawerForRow(tableRow);
        return;
      }
      const agg = detailAggregate[key];
      const runs = agg?.runs ?? [];
      const last = runs[runs.length - 1];
      const n = runs.length;
      setDrawerPayload({
        title: `${row.scenario} / ${row.api}`,
        scenario: row.scenario,
        api: row.api,
        modelId: row.modelId,
        ttft_ms: row.ttft != null && Number.isFinite(row.ttft) ? row.ttft : null,
        pass: row.pass,
        score: last?.quality?.score,
        qualityReason: last?.quality?.reason,
        systemPrompt:
          agg?.system_prompt ??
          systemPromptByRowKey[key] ??
          defaultScenarioSystemPromptPreview(row.scenario),
        userPrompt:
          agg?.user_prompt ??
          promptByRowKey[key] ??
          defaultScenarioPromptPreview(row.scenario),
        outputText: last?.output_text ?? "",
        measuredRunIndex: n > 0 ? n : undefined,
        measuredRunTotal: n > 0 ? n : undefined,
      });
      setDrawerOpen(true);
    },
    [detailAggregate, promptByRowKey, rows, openDrawerForRow, systemPromptByRowKey],
  );

  return (
    <>
      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
        <h2 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{m.stats.savedModelsTitle}</h2>
        <p className="mb-3 text-xs text-[var(--muted)]">
          {m.stats.savedModelsDesc}
        </p>
        {listLoading ? (
          <div role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {m.stats.listLoading}
          </div>
        ) : listItems.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{m.stats.noRuns}</p>
        ) : (
          <>
            {selectableCount === 0 ? (
              <p className="mb-3 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
                {m.stats.noSelectable}
              </p>
            ) : null}
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium shadow-sm"
                onClick={() => setSelectedIds([])}
              >
                {m.stats.deselectAll}
              </button>
              {detailLoading ? (
                <span role="status" className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  {m.stats.detailLoading}
                </span>
              ) : null}
            </div>
            <StatsModelTable
              models={listItems}
              selected={selectedMap}
              onToggle={toggleRun}
              onSelectAll={handleSelectAllStats}
              sorting={statsListSorting}
              onSortingChange={setStatsListSorting}
              onSortedRunIdsChange={setSortedRunIdsFromTable}
              canSelectRow={canSelectStatsRow}
            />
          </>
        )}
      </section>

      <Scoreboard rows={rows} detailAggregate={detailAggregate} providerByModel={providerByModel} />

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <Activity className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
            {m.stats.metricChartTitle}
          </h2>
          <HighlightToggle on={hlPreview} onChange={setHlPreview} />
        </div>
        {chartModelIds.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3">
            <span className="text-xs font-medium text-[var(--muted)]">{m.stats.chartModels}</span>
            {chartModelIds.map((id) => (
              <label
                key={id}
                className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--foreground)]"
              >
                <input
                  type="checkbox"
                  checked={chartModelFilter[id] !== false}
                  onChange={() =>
                    setChartModelFilter((prev) => ({
                      ...prev,
                      [id]: !(prev[id] !== false),
                    }))
                  }
                />
                <span className="truncate font-mono" title={id}>
                  {id}
                </span>
              </label>
            ))}
          </div>
        ) : null}
        {!selectionKey ? (
          <p className="py-8 text-center text-sm text-[var(--muted)]">{m.stats.selectAtLeastOne}</p>
        ) : chartRows.length > 0 && filteredChartRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--muted)]">{m.stats.selectAtLeastOneVisible}</p>
        ) : filteredChartRows.length > 0 ? (
          <BenchCharts chartRows={filteredChartRows} onBarPayload={(row) => openFromChartRow(row)} />
        ) : detailLoading ? (
          <p className="py-8 text-center text-sm text-[var(--muted)]">{m.stats.chartLoading}</p>
        ) : (
          <p className="py-8 text-center text-sm text-[var(--muted)]">{m.stats.noScenarioAgg}</p>
        )}
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
        <h2 className="mb-3 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--foreground)]">{m.stats.resultsTableTitle}</h2>
        {rows.length > 0 ? (
          <ResultsTable rows={rows} onRowClick={(r) => openDrawerForRow(r)} />
        ) : (
          <p className="text-sm text-[var(--muted)]">{m.stats.noResults}</p>
        )}
      </section>

      <ScenarioDetailDrawer
        open={drawerOpen}
        payload={drawerPayload}
        hlPreview={hlPreview}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerPayload(null);
        }}
      />
    </>
  );
}
