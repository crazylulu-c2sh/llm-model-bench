import type { StatsModelLatestItem } from "../api-types";
import type { ScenarioCategory } from "@llm-bench/shared";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type Column,
  type OnChangeFn,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowDownUp, ArrowUp, CheckSquare, Search, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelLabel } from "./ModelLabel";

export const DEFAULT_STATS_MODEL_SORTING: SortingState = [{ id: "model_id", desc: false }];

// 시나리오 카테고리 칩 필터 — 고정 순서와 라벨. (백엔드 scenarioCategory와 동일한 3분류)
const CATEGORY_ORDER: ScenarioCategory[] = ["text", "vision", "agent"];
const CATEGORY_LABELS: Record<ScenarioCategory, string> = {
  text: "텍스트",
  vision: "비전",
  agent: "에이전트",
};

const POINTER_MOVE_TOGGLE_THRESHOLD_PX = 5;

function selectionWithTextAnchoredInRow(tr: HTMLTableRowElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  if (!sel.toString()) return false;
  const a = sel.anchorNode;
  const f = sel.focusNode;
  if (a && tr.contains(a)) return true;
  if (f && tr.contains(f)) return true;
  return false;
}

function sortDirIcon(column: Column<StatsModelLatestItem, unknown>) {
  const s = column.getIsSorted();
  if (s === "asc") return <ArrowUp className="size-3.5 shrink-0 opacity-90" aria-hidden />;
  if (s === "desc") return <ArrowDown className="size-3.5 shrink-0 opacity-90" aria-hidden />;
  return <ArrowDownUp className="size-3.5 shrink-0 opacity-45" aria-hidden />;
}

const SORT_LABELS: Record<string, string> = {
  model_id: "모델 id",
  base_url: "Base URL",
  provider: "provider",
  finished_at: "완료 시각",
  scenario_count: "시나리오 수",
  status: "상태",
};

function statsModelSortLine(sorting: SortingState): string {
  const first = sorting[0];
  if (!first) return "정렬: 없음";
  const name = SORT_LABELS[first.id] ?? first.id;
  const dir = first.desc ? "내림차순" : "오름차순";
  return `정렬: ${name} · ${dir}`;
}

const columnHelper = createColumnHelper<StatsModelLatestItem>();

export function StatsModelTable({
  models,
  selected,
  onToggle,
  onSelectAll,
  sorting,
  onSortingChange,
  onSortedRunIdsChange,
  canSelectRow,
}: {
  models: StatsModelLatestItem[];
  selected: Record<string, boolean>;
  onToggle: (runId: string) => void;
  /** 현재 표에 보이는(필터 통과) 선택 가능한 run_id만 토글합니다. */
  onSelectAll: (next: boolean, runIds: string[]) => void;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  /** 현재 정렬 기준으로 표에 보이는 행의 run_id 순서(전체 행). */
  onSortedRunIdsChange?: (runIds: string[]) => void;
  canSelectRow: (row: StatsModelLatestItem) => boolean;
}) {
  const data = useMemo(() => models.map((m) => ({ ...m })), [models]);

  // 텍스트 필터 — TanStack `data`는 전체 유지하고 렌더 단계에서만 거른다.
  // (`onSortedRunIdsChange`가 보고하는 run_id 순서를 줄이면 차트 정렬이 어긋나므로 globalFilter는 쓰지 않음.)
  const [filterText, setFilterText] = useState("");
  const q = filterText.trim().toLowerCase();
  const matchesQuery = useCallback(
    (m: StatsModelLatestItem) =>
      !q ||
      m.model_id.toLowerCase().includes(q) ||
      m.base_url.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q),
    [q],
  );

  // 카테고리 칩 필터 — 양성 선택(비어 있으면 전체). 다중 선택은 합집합(OR).
  const [selectedCategories, setSelectedCategories] = useState<Set<ScenarioCategory>>(
    () => new Set(),
  );
  const matchesCategory = useCallback(
    (m: StatsModelLatestItem) =>
      selectedCategories.size === 0 || (m.categories ?? []).some((c) => selectedCategories.has(c)),
    [selectedCategories],
  );
  const matchesFilters = useCallback(
    (m: StatsModelLatestItem) => matchesQuery(m) && matchesCategory(m),
    [matchesQuery, matchesCategory],
  );
  // 실제 존재하는 카테고리별 모델 수 — 칩 배지·렌더 대상 결정용.
  const categoryCounts = useMemo(() => {
    const counts = new Map<ScenarioCategory, number>();
    for (const m of data) {
      for (const c of new Set(m.categories ?? [])) {
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    return counts;
  }, [data]);
  const toggleCategory = useCallback((c: ScenarioCategory) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }, []);

  // 목록이 바뀌면 필터를 초기화해 stale 필터가 새 목록을 가리지 않게 함.
  useEffect(() => {
    setFilterText("");
    setSelectedCategories(new Set());
  }, [models]);
  const visibleModels = useMemo(() => data.filter(matchesFilters), [data, matchesFilters]);

  const selectableRows = useMemo(() => data.filter(canSelectRow), [data, canSelectRow]);
  const allSelectableSelected =
    selectableRows.length > 0 && selectableRows.every((m) => selected[m.run_id]);
  const someSelectableSelected = selectableRows.some((m) => selected[m.run_id]);

  // 전체 선택 토글은 "표시된(필터 통과) 선택 가능 행"만 대상으로 한다.
  const visibleSelectable = useMemo(
    () => visibleModels.filter(canSelectRow),
    [visibleModels, canSelectRow],
  );
  const allVisibleSelectableSelected =
    visibleSelectable.length > 0 && visibleSelectable.every((m) => selected[m.run_id]);
  const noVisibleSelectable = visibleSelectable.length === 0;
  const visibleSelectableRunIdsRef = useRef<string[]>([]);
  visibleSelectableRunIdsRef.current = visibleSelectable.map((m) => m.run_id);
  const handleSelectAllVisible = useCallback(() => {
    onSelectAll(!allVisibleSelectableSelected, visibleSelectableRunIdsRef.current);
  }, [allVisibleSelectableSelected, onSelectAll]);

  const rowPointerRef = useRef<{ x: number; y: number; runId: string } | null>(null);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: () => (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:pointer-events-none disabled:opacity-50"
            aria-label={allVisibleSelectableSelected ? "표시된 선택 가능 항목 전체 해제" : "표시된 선택 가능 항목 전체 선택"}
            title={allVisibleSelectableSelected ? "표시된 선택 가능 항목 전체 해제" : "표시된 선택 가능 항목 전체 선택"}
            disabled={noVisibleSelectable}
            onClick={handleSelectAllVisible}
          >
            {allVisibleSelectableSelected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
          </button>
        ),
        cell: (ctx) => {
          const row = ctx.row.original;
          const ok = canSelectRow(row);
          return (
            <input
              type="checkbox"
              checked={!!selected[row.run_id]}
              disabled={!ok}
              onChange={() => {
                if (!ok) return;
                onToggle(row.run_id);
              }}
              aria-label={`${row.model_id} 선택`}
            />
          );
        },
        enableSorting: false,
      }),
      columnHelper.accessor("model_id", {
        id: "model_id",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            id
            {sortDirIcon(column)}
          </button>
        ),
        cell: (info) => <ModelLabel modelId={info.getValue()} showQuant size={14} className="text-xs" />,
        sortingFn: "alphanumeric",
      }),
      columnHelper.accessor((row) => normalizeBaseUrlForCell(row.base_url), {
        id: "base_url",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Base URL
            {sortDirIcon(column)}
          </button>
        ),
        cell: ({ row }) => <span className="max-w-[14rem] break-all font-mono text-[10px] text-[var(--muted)]">{row.original.base_url}</span>,
        sortingFn: "alphanumeric",
      }),
      columnHelper.accessor("provider", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            provider
            {sortDirIcon(column)}
          </button>
        ),
        cell: (info) => <span className="whitespace-nowrap text-xs">{info.getValue()}</span>,
        sortingFn: "alphanumeric",
      }),
      columnHelper.accessor("status", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            상태
            {sortDirIcon(column)}
          </button>
        ),
        cell: (info) => <span className="whitespace-nowrap text-xs text-[var(--muted)]">{info.getValue()}</span>,
        sortingFn: "alphanumeric",
      }),
      columnHelper.accessor("finished_at", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            완료
            {sortDirIcon(column)}
          </button>
        ),
        cell: (info) => (
          <span className="whitespace-nowrap font-mono text-[10px] text-[var(--muted)]">{info.getValue().slice(0, 19)}</span>
        ),
        sortingFn: "alphanumeric",
      }),
      columnHelper.accessor((row) => row.scenario_count ?? 0, {
        id: "scenario_count",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            시나리오
            {sortDirIcon(column)}
          </button>
        ),
        cell: (info) => <span className="whitespace-nowrap font-mono text-xs text-[var(--muted)]">{info.getValue()}</span>,
        sortingFn: "basic",
      }),
    ],
    [allVisibleSelectableSelected, canSelectRow, handleSelectAllVisible, noVisibleSelectable, onToggle, selected],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.run_id,
  });

  useEffect(() => {
    onSortedRunIdsChange?.(table.getRowModel().rows.map((r) => r.original.run_id));
  }, [data, onSortedRunIdsChange, sorting, table]);

  // 정렬된 전체 행 중 필터(텍스트+카테고리)에 맞는 행만 표시(데이터/정렬/보고 run_id는 전체 유지).
  const visibleRows = table.getRowModel().rows.filter((r) => matchesFilters(r.original));

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-[var(--muted)]">카테고리:</span>
        {/* 3분류는 항상 노출한다 — 측정 0건이어도 그 축이 존재함을 알려야 하므로 숨기지 않음. */}
        {CATEGORY_ORDER.map((c) => {
          const count = categoryCounts.get(c) ?? 0;
          const active = selectedCategories.has(c);
          // 0건 카테고리는 누르면 빈 표만 되므로 보이되 비활성.
          const empty = count === 0;
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggleCategory(c)}
              disabled={empty}
              aria-pressed={active}
              title={
                empty
                  ? `${CATEGORY_LABELS[c]} 측정이 있는 모델이 없습니다`
                  : `${CATEGORY_LABELS[c]} ${active ? "필터 해제" : "필터 적용"}`
              }
              style={
                active ? { background: "color-mix(in srgb, var(--accent) 14%, transparent)" } : undefined
              }
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors ${
                empty
                  ? "cursor-not-allowed border-dashed border-[var(--border)] text-[var(--muted)] opacity-55"
                  : active
                    ? "border-[var(--accent)] font-medium text-[var(--foreground)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-sm hover:border-[var(--accent)]"
              }`}
            >
              {CATEGORY_LABELS[c]}
              <span className="text-[var(--muted)]">{count}</span>
            </button>
          );
        })}
        {selectedCategories.size > 0 ? (
          <button
            type="button"
            onClick={() => setSelectedCategories(new Set())}
            className="ml-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[var(--muted)] shadow-sm hover:text-[var(--foreground)]"
          >
            전체
          </button>
        ) : null}
      </div>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted)]"
          aria-hidden
        />
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="모델 id·Base URL·provider 검색 (예: gemma)"
          aria-label="저장된 모델 필터"
          spellCheck={false}
          className="w-full rounded border border-[var(--border)] bg-[var(--surface-2)] py-1.5 pl-7 pr-7 font-mono text-xs text-[var(--foreground)]"
        />
        {filterText ? (
          <button
            type="button"
            aria-label="필터 지우기"
            title="필터 지우기"
            onClick={() => setFilterText("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="max-h-64 overflow-auto rounded border border-[var(--border)]">
        <table className="w-full text-left text-sm">
        <caption className="sr-only">저장된 모델 통계</caption>
        <thead className="text-[var(--muted)]">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const sorted = h.column.getIsSorted();
                return (
                  <th
                    key={h.id}
                    scope="col"
                    aria-sort={
                      h.column.getCanSort()
                        ? sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : "none"
                        : undefined
                    }
                    className="sticky top-0 z-[1] bg-[var(--surface)] p-2"
                  >
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td
                colSpan={table.getVisibleLeafColumns().length}
                className="p-3 text-center text-xs text-[var(--muted)]"
              >
                일치하는 모델이 없습니다
              </td>
            </tr>
          ) : (
            visibleRows.map((row) => {
            const ok = canSelectRow(row.original);
            return (
              <tr
                key={row.id}
                className={[
                  ok ? "cursor-pointer border-t border-[var(--border)] hover:bg-[var(--surface-2)] focus-visible:bg-[var(--surface-2)]" : "border-t border-[var(--border)] opacity-55",
                ].join(" ")}
                tabIndex={ok ? 0 : -1}
                aria-disabled={!ok || undefined}
                aria-label={ok ? `${row.original.model_id} 선택 토글` : undefined}
                title={!ok ? "시나리오 측정 집계가 없어 선택할 수 없습니다." : undefined}
                onMouseDown={(e) => {
                  if (!ok) return;
                  const el = e.target as HTMLElement;
                  if (el.closest('input[type="checkbox"]')) return;
                  rowPointerRef.current = {
                    x: e.clientX,
                    y: e.clientY,
                    runId: row.original.run_id,
                  };
                }}
                onClick={(e) => {
                  if (!ok) return;
                  const el = e.target as HTMLElement;
                  const start = rowPointerRef.current;
                  rowPointerRef.current = null;
                  if (el.closest('input[type="checkbox"]')) return;
                  if (!start || start.runId !== row.original.run_id) return;
                  const tr = e.currentTarget;
                  if (
                    Math.abs(e.clientX - start.x) > POINTER_MOVE_TOGGLE_THRESHOLD_PX ||
                    Math.abs(e.clientY - start.y) > POINTER_MOVE_TOGGLE_THRESHOLD_PX
                  ) {
                    return;
                  }
                  if (selectionWithTextAnchoredInRow(tr)) return;
                  onToggle(row.original.run_id);
                }}
                onKeyDown={(e) => {
                  if (!ok) return;
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  onToggle(row.original.run_id);
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="p-2 align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })
          )}
        </tbody>
      </table>
        <p className="border-t border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted)]">
          {statsModelSortLine(sorting)}
          {" · "}
          선택 {selectableRows.filter((m) => selected[m.run_id]).length} / {selectableRows.length}
          {q ? ` · 필터 "${q}"` : null}
          {selectedCategories.size > 0
            ? ` · 카테고리: ${CATEGORY_ORDER.filter((c) => selectedCategories.has(c))
                .map((c) => CATEGORY_LABELS[c])
                .join("·")}`
            : null}
          {q || selectedCategories.size > 0 ? ` · ${visibleModels.length}개 표시` : null}
          {someSelectableSelected && !allSelectableSelected ? " · 일부 선택됨" : null}
        </p>
      </div>
    </div>
  );
}

function normalizeBaseUrlForCell(url: string): string {
  return url.replace(/\/+$/, "");
}
