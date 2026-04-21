import { getScenarioUserPromptPreview } from "@llm-bench/shared";
import { Activity, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { BenchRunDetailResponse, StatsModelLatestItem, StatsModelLatestResponse } from "./api-types";
import { BenchCharts } from "./components/BenchCharts";
import { scenarioRowKey, type ChartRow } from "./components/chart-types";
import { HighlightToggle } from "./components/JsonCodeBlock";
import type { ResultRow } from "./components/ResultsTable";
import { ResultsTable } from "./components/ResultsTable";
import { ScenarioDetailDrawer, type ScenarioDetailPayload } from "./components/ScenarioDetailDrawer";
import { buildChartRowsFromBenchState, mergeBenchDetailsToState, type MetricsAgg } from "./stats/hydrateBenchUi";

function statsItemHasResults(it: StatsModelLatestItem): boolean {
  return (it.scenario_count ?? 0) > 0;
}

function defaultScenarioPromptPreview(scenarioId: string): string {
  if (scenarioId === "translate_nist_fips197_pdf_tools" && typeof window !== "undefined") {
    return getScenarioUserPromptPreview(scenarioId, { publicAssetBaseUrl: window.location.origin });
  }
  if (scenarioId === "chat_time_calendar") {
    return getScenarioUserPromptPreview(scenarioId, {
      referenceIso: new Date().toISOString(),
      calendarTimeZone: "Asia/Seoul",
    });
  }
  return getScenarioUserPromptPreview(scenarioId);
}

export function StatsPage() {
  const [listItems, setListItems] = useState<StatsModelLatestItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [detailAggregate, setDetailAggregate] = useState<Record<string, MetricsAgg>>({});
  const [promptByRowKey, setPromptByRowKey] = useState<Record<string, string>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPayload, setDrawerPayload] = useState<ScenarioDetailPayload | null>(null);
  const [hlPreview, setHlPreview] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setListLoading(true);
      try {
        const res = await fetch("/api/stats/model-latest");
        const j = (await res.json()) as StatsModelLatestResponse;
        if (cancelled) return;
        if (j.sqlite_available === false) {
          toast.warning(
            j.sqlite_error ??
              "SQLite를 사용할 수 없습니다. 서버에서 `pnpm rebuild better-sqlite3` 등을 확인하세요.",
          );
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

  const selectionKey = selectedIds.slice().sort().join("\0");

  useEffect(() => {
    if (!selectionKey) {
      setRows([]);
      setDetailAggregate({});
      setPromptByRowKey({});
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
          toast.warning(`일부 런(${failed}건)을 불러오지 못했습니다.`);
        }
        const ok = results.filter((r): r is BenchRunDetailResponse => r != null && Array.isArray(r.scenarios));
        const merged = mergeBenchDetailsToState(ok);
        setRows(merged.rows);
        setDetailAggregate(merged.detailAggregate);
        setPromptByRowKey(merged.promptByRowKey);
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

  const chartRows = useMemo(
    () => buildChartRowsFromBenchState(rows, detailAggregate),
    [rows, detailAggregate],
  );

  const chartModelIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of chartRows) {
      if (r.modelId) s.add(r.modelId);
    }
    return [...s].sort();
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

  const toggleRun = useCallback((runId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(runId)) return prev.filter((x) => x !== runId);
      const it = listItems.find((x) => x.run_id === runId);
      if (!it || !statsItemHasResults(it)) return prev;
      return [...prev, runId];
    });
  }, [listItems]);

  const selectableItems = useMemo(() => listItems.filter(statsItemHasResults), [listItems]);

  const selectAll = useCallback(() => {
    setSelectedIds(selectableItems.map((i) => i.run_id));
  }, [selectableItems]);

  const selectNone = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const openDrawerForRow = useCallback(
    (row: ResultRow) => {
      const agg = detailAggregate[row.rowKey];
      const runs = agg?.runs ?? [];
      const last = runs[runs.length - 1];
      setDrawerPayload({
        title: `${row.scenario} / ${row.api}`,
        scenario: row.scenario,
        api: row.api,
        modelId: row.model_id,
        ttft_ms: row.ttft_ms,
        tpot_ms: row.tpot_ms,
        pass: row.pass,
        qualityReason: row.reason ?? last?.quality?.reason,
        prompt: promptByRowKey[row.rowKey] ?? defaultScenarioPromptPreview(row.scenario),
        outputText: last?.output_text ?? "",
      });
      setDrawerOpen(true);
    },
    [detailAggregate, promptByRowKey],
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
      setDrawerPayload({
        title: `${row.scenario} / ${row.api}`,
        scenario: row.scenario,
        api: row.api,
        modelId: row.modelId,
        ttft_ms: row.ttft > 0 ? row.ttft : null,
        tpot_ms: row.tpot > 0 ? row.tpot : null,
        pass: row.pass,
        qualityReason: last?.quality?.reason,
        prompt: promptByRowKey[key] ?? defaultScenarioPromptPreview(row.scenario),
        outputText: last?.output_text ?? "",
      });
      setDrawerOpen(true);
    },
    [detailAggregate, promptByRowKey, rows, openDrawerForRow],
  );

  return (
    <>
      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
        <h2 className="mb-2 text-sm font-semibold text-[var(--foreground)]">저장된 모델 (최신 런 기준)</h2>
        <p className="mb-3 text-xs text-[var(--muted)]">
          (model_id + Base URL) 조합마다 SQLite에 기록된 가장 최근 완료 런입니다. 시나리오 측정 집계가 없는 런은 선택할 수 없습니다.
        </p>
        {listLoading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            목록 불러오는 중…
          </div>
        ) : listItems.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">표시할 완료 런이 없습니다. 벤치를 먼저 실행하세요.</p>
        ) : (
          <>
            {selectableItems.length === 0 ? (
              <p className="mb-3 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
                아래 런에는 시나리오 측정 집계가 없어 선택할 수 없습니다. 벤치가 중단되었거나 저장 전 오류가 있었을 수 있습니다.
              </p>
            ) : null}
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                disabled={selectableItems.length === 0}
                onClick={selectAll}
              >
                전체 선택
              </button>
              <button
                type="button"
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium shadow-sm"
                onClick={selectNone}
              >
                선택 해제
              </button>
              {detailLoading ? (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  상세 로드 중…
                </span>
              ) : null}
            </div>
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
              {listItems.map((it) => {
                const checked = selectedIds.includes(it.run_id);
                const canSelect = statsItemHasResults(it);
                return (
                  <li key={it.run_id}>
                    <label
                      className={`flex items-start gap-2 rounded px-2 py-1 ${
                        canSelect ? "cursor-pointer hover:bg-[var(--surface-2)]" : "cursor-not-allowed opacity-55"
                      }`}
                      title={
                        canSelect
                          ? undefined
                          : "시나리오 측정 집계가 없어 차트·표에 쓸 데이터가 없습니다. 선택할 수 없습니다."
                      }
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        disabled={!canSelect}
                        checked={checked}
                        onChange={() => toggleRun(it.run_id)}
                      />
                      <span className="min-w-0 flex-1 font-mono">
                        <span className="text-[var(--foreground)]">{it.model_id}</span>
                        <span className="block break-all text-[var(--muted)]">{it.base_url}</span>
                        <span className="text-[var(--muted)]">
                          {it.provider} · {it.status} · {it.finished_at.slice(0, 19)}
                          {!canSelect ? " · 집계 없음" : null}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <Activity className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
            메트릭 차트
          </h2>
          <HighlightToggle on={hlPreview} onChange={setHlPreview} />
        </div>
        {chartModelIds.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3">
            <span className="text-xs font-medium text-[var(--muted)]">차트 모델</span>
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
          <p className="py-8 text-center text-sm text-[var(--muted)]">위에서 모델을 하나 이상 선택하세요.</p>
        ) : chartRows.length > 0 && filteredChartRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--muted)]">표시할 모델을 하나 이상 선택하세요.</p>
        ) : filteredChartRows.length > 0 ? (
          <BenchCharts chartRows={filteredChartRows} onBarPayload={(row) => openFromChartRow(row)} />
        ) : detailLoading ? (
          <p className="py-8 text-center text-sm text-[var(--muted)]">차트 데이터를 불러오는 중…</p>
        ) : (
          <p className="py-8 text-center text-sm text-[var(--muted)]">선택한 런에 시나리오 집계가 없습니다.</p>
        )}
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm p-4">
        <h2 className="mb-3 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--foreground)]">결과 테이블</h2>
        {rows.length > 0 ? (
          <ResultsTable rows={rows} onRowClick={(r) => openDrawerForRow(r)} />
        ) : (
          <p className="text-sm text-[var(--muted)]">선택한 런의 결과가 없습니다.</p>
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
