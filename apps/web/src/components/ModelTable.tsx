import type { DetectResult } from "@llm-bench/shared";
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

/** 테이블과 App의 기본 정렬(id 오름차순)을 맞춥니다. */
export const DEFAULT_MODEL_TABLE_SORTING: SortingState = [{ id: "id", desc: false }];

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

type ModelRow = DetectResult["models"][number];

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const rounded = i === 0 ? Math.round(v) : v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${rounded} ${units[i]}`;
}

function formatParamsDisplay(m: ModelRow): string {
  const s = m.params_string?.trim();
  return s ? s : "—";
}

function formatDiskDisplay(m: ModelRow): string {
  if (m.size_bytes == null || m.size_bytes <= 0) return "—";
  const b = formatBytes(m.size_bytes);
  return b || "—";
}

const columnHelper = createColumnHelper<ModelRow>();

function sortDirIcon(column: Column<ModelRow, unknown>) {
  const s = column.getIsSorted();
  if (s === "asc") return <ArrowUp className="size-3.5 shrink-0 opacity-90" aria-hidden />;
  if (s === "desc") return <ArrowDown className="size-3.5 shrink-0 opacity-90" aria-hidden />;
  return <ArrowDownUp className="size-3.5 shrink-0 opacity-45" aria-hidden />;
}

function modelTableSortLine(sorting: SortingState): string {
  const first = sorting[0];
  if (!first) return "정렬: 없음";
  const labels: Record<string, string> = {
    id: "모델 id",
    label: "label",
    params_string: "규모",
    size_bytes: "디스크",
  };
  const name = labels[first.id] ?? first.id;
  const dir = first.desc ? "내림차순" : "오름차순";
  return `정렬: ${name} · ${dir}`;
}

export function ModelTable({
  models,
  selected,
  onToggle,
  onSelectAll,
  sorting,
  onSortingChange,
  onSortedModelIdsChange,
  selectionDisabled = false,
  profileHintByModelId,
}: {
  models: DetectResult["models"];
  selected: Record<string, boolean>;
  onToggle: (id: string) => void;
  onSelectAll: (next: boolean) => void;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  /** 현재 정렬 기준으로 표에 보이는 모델 id 순서(전체 행). */
  onSortedModelIdsChange?: (ids: string[]) => void;
  /** true이면 체크·행 토글·전체 선택을 막습니다(예: 벤치 실행 중). */
  selectionDisabled?: boolean;
  profileHintByModelId?: Record<string, string>;
}) {
  const data = useMemo<ModelRow[]>(() => models.map((m) => ({ ...m })), [models]);
  const allSelected = models.length > 0 && models.every((m) => selected[m.id]);
  const someSelected = models.some((m) => selected[m.id]);
  const rowPointerRef = useRef<{ x: number; y: number; modelId: string } | null>(null);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: () => (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:pointer-events-none disabled:opacity-50"
            aria-label={allSelected ? "전체 해제" : "전체 선택"}
            title={allSelected ? "전체 해제" : "전체 선택"}
            disabled={selectionDisabled}
            onClick={() => {
              if (selectionDisabled) return;
              onSelectAll(!allSelected);
            }}
          >
            {allSelected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
          </button>
        ),
        cell: (ctx) => (
          <input
            type="checkbox"
            checked={!!selected[ctx.row.original.id]}
            disabled={selectionDisabled}
            onChange={() => {
              if (selectionDisabled) return;
              onToggle(ctx.row.original.id);
            }}
            aria-label={`${ctx.row.original.id} 선택`}
          />
        ),
        enableSorting: false,
      }),
      columnHelper.accessor("id", {
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
      columnHelper.accessor("label", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            label
            {sortDirIcon(column)}
          </button>
        ),
        cell: (info) => <span className="text-xs">{info.getValue() ?? ""}</span>,
        sortingFn: "alphanumeric",
      }),
      columnHelper.accessor((row) => row.params_string?.trim() ?? "", {
        id: "params_string",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            규모
            {sortDirIcon(column)}
          </button>
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-[var(--muted)]">{formatParamsDisplay(row.original)}</span>
        ),
        sortingFn: "alphanumeric",
      }),
      columnHelper.accessor((row) => (row.size_bytes != null && row.size_bytes > 0 ? row.size_bytes : undefined), {
        id: "size_bytes",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            디스크
            {sortDirIcon(column)}
          </button>
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-xs text-[var(--muted)]">{formatDiskDisplay(row.original)}</span>
        ),
        sortingFn: "basic",
        sortUndefined: "last",
      }),
      columnHelper.display({
        id: "profile_hint",
        header: () => <span className="font-medium text-[var(--muted)]">프로파일</span>,
        cell: ({ row }) => (
          <span className="block max-w-[14rem] truncate font-mono text-[10px] leading-tight text-[var(--muted)]" title={profileHintByModelId?.[row.original.id]}>
            {profileHintByModelId?.[row.original.id] ?? "—"}
          </span>
        ),
        enableSorting: false,
      }),
    ],
    [allSelected, onSelectAll, onToggle, profileHintByModelId, selected, selectionDisabled],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  useEffect(() => {
    onSortedModelIdsChange?.(table.getRowModel().rows.map((r) => r.original.id));
  }, [data, onSortedModelIdsChange, sorting, table]);

  return (
    <div className="max-h-64 overflow-auto rounded border border-[var(--border)]">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-[1] bg-[var(--surface)] text-[var(--muted)]">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className="p-2">
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className={
                selectionDisabled
                  ? "border-t border-[var(--border)] opacity-80"
                  : "cursor-pointer border-t border-[var(--border)] hover:bg-[var(--surface-2)]"
              }
              tabIndex={selectionDisabled ? -1 : 0}
              aria-disabled={selectionDisabled || undefined}
              aria-label={`${row.original.id} 선택 토글`}
              onMouseDown={(e) => {
                if (selectionDisabled) return;
                const el = e.target as HTMLElement;
                if (el.closest('input[type="checkbox"]')) return;
                rowPointerRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  modelId: row.original.id,
                };
              }}
              onClick={(e) => {
                if (selectionDisabled) return;
                const el = e.target as HTMLElement;
                const start = rowPointerRef.current;
                rowPointerRef.current = null;
                if (el.closest('input[type="checkbox"]')) return;
                if (!start || start.modelId !== row.original.id) return;
                const tr = e.currentTarget;
                if (
                  Math.abs(e.clientX - start.x) > POINTER_MOVE_TOGGLE_THRESHOLD_PX ||
                  Math.abs(e.clientY - start.y) > POINTER_MOVE_TOGGLE_THRESHOLD_PX
                ) {
                  return;
                }
                if (selectionWithTextAnchoredInRow(tr)) return;
                onToggle(row.original.id);
              }}
              onKeyDown={(e) => {
                if (selectionDisabled) return;
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onToggle(row.original.id);
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="p-2 align-middle">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted)]">
        {modelTableSortLine(sorting)}
        {" · "}
        선택 {models.filter((m) => selected[m.id]).length} / {models.length}
        {someSelected && !allSelected ? " · 일부 선택됨" : null}
        {selectionDisabled ? " · 벤치 실행 중에는 선택을 바꿀 수 없습니다." : null}
      </p>
    </div>
  );
}
