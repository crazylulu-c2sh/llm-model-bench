import type { DetectResult } from "@llm-bench/shared";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDownUp, CheckSquare, Square } from "lucide-react";
import { useMemo } from "react";

type ModelRow = { id: string; label?: string };

const columnHelper = createColumnHelper<ModelRow>();

export function ModelTable({
  models,
  selected,
  onToggle,
  onSelectAll,
}: {
  models: DetectResult["models"];
  selected: Record<string, boolean>;
  onToggle: (id: string) => void;
  onSelectAll: (next: boolean) => void;
}) {
  const data = useMemo<ModelRow[]>(() => models.map((m) => ({ id: m.id, label: m.label })), [models]);
  const allSelected = models.length > 0 && models.every((m) => selected[m.id]);
  const someSelected = models.some((m) => selected[m.id]);

  const table = useReactTable({
    data,
    columns: [
      columnHelper.display({
        id: "select",
        header: () => (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            aria-label={allSelected ? "전체 해제" : "전체 선택"}
            title={allSelected ? "전체 해제" : "전체 선택"}
            onClick={() => onSelectAll(!allSelected)}
          >
            {allSelected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
          </button>
        ),
        cell: (ctx) => (
          <input
            type="checkbox"
            checked={!!selected[ctx.row.original.id]}
            onChange={() => onToggle(ctx.row.original.id)}
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
            <ArrowDownUp className="size-3.5 opacity-70" aria-hidden />
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
            <ArrowDownUp className="size-3.5 opacity-70" aria-hidden />
          </button>
        ),
        cell: (info) => <span className="text-xs">{info.getValue() ?? ""}</span>,
        sortingFn: "alphanumeric",
      }),
    ],
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: { sorting: [{ id: "id", desc: false }] },
  });

  return (
    <div className="max-h-64 overflow-auto rounded border border-[var(--border)]">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-[var(--surface)] text-[var(--muted)]">
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
            <tr key={row.id} className="border-t border-[var(--border)]">
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
        선택 {models.filter((m) => selected[m.id]).length} / {models.length}
        {someSelected && !allSelected ? " · 일부 선택됨" : null}
      </p>
    </div>
  );
}
