import type { StatsModelLatestItem } from "../api-types";
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
import { ArrowDown, ArrowDownUp, ArrowUp, CheckSquare, Square } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

export const DEFAULT_STATS_MODEL_SORTING: SortingState = [{ id: "model_id", desc: false }];

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
  onSelectAll: (next: boolean) => void;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  /** 현재 정렬 기준으로 표에 보이는 행의 run_id 순서(전체 행). */
  onSortedRunIdsChange?: (runIds: string[]) => void;
  canSelectRow: (row: StatsModelLatestItem) => boolean;
}) {
  const data = useMemo(() => models.map((m) => ({ ...m })), [models]);
  const selectableRows = useMemo(() => data.filter(canSelectRow), [data, canSelectRow]);
  const allSelectableSelected =
    selectableRows.length > 0 && selectableRows.every((m) => selected[m.run_id]);
  const someSelectableSelected = selectableRows.some((m) => selected[m.run_id]);
  const rowPointerRef = useRef<{ x: number; y: number; runId: string } | null>(null);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: () => (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:pointer-events-none disabled:opacity-50"
            aria-label={allSelectableSelected ? "선택 가능 항목 전체 해제" : "선택 가능 항목 전체 선택"}
            title={allSelectableSelected ? "선택 가능 항목 전체 해제" : "선택 가능 항목 전체 선택"}
            disabled={selectableRows.length === 0}
            onClick={() => {
              if (selectableRows.length === 0) return;
              onSelectAll(!allSelectableSelected);
            }}
          >
            {allSelectableSelected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
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
        cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
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
    [allSelectableSelected, canSelectRow, onSelectAll, onToggle, selectableRows.length, selected],
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

  return (
    <div className="max-h-64 overflow-auto rounded border border-[var(--border)]">
      <table className="w-full text-left text-sm">
        <thead className="text-[var(--muted)]">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className="sticky top-0 z-[1] bg-[var(--surface)] p-2">
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const ok = canSelectRow(row.original);
            return (
              <tr
                key={row.id}
                className={[
                  ok ? "cursor-pointer border-t border-[var(--border)] hover:bg-[var(--surface-2)]" : "border-t border-[var(--border)] opacity-55",
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
          })}
        </tbody>
      </table>
      <p className="border-t border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted)]">
        {statsModelSortLine(sorting)}
        {" · "}
        선택 {selectableRows.filter((m) => selected[m.run_id]).length} / {selectableRows.length}
        {someSelectableSelected && !allSelectableSelected ? " · 일부 선택됨" : null}
      </p>
    </div>
  );
}

function normalizeBaseUrlForCell(url: string): string {
  return url.replace(/\/+$/, "");
}
