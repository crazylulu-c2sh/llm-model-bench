import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDownUp, CircleCheck, CircleX, HelpCircle } from "lucide-react";
import { useMemo } from "react";

export type ResultRow = {
  scenario: string;
  api: string;
  ttft_ms: number | null;
  tpot_ms: number | null;
  pass?: boolean;
};

const columnHelper = createColumnHelper<ResultRow>();

export function ResultsTable({ rows }: { rows: ResultRow[] }) {
  const data = useMemo(() => rows, [rows]);

  const table = useReactTable({
    data,
    columns: [
      columnHelper.accessor("scenario", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            시나리오
            <ArrowDownUp className="size-3.5 opacity-70" aria-hidden />
          </button>
        ),
        cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
      }),
      columnHelper.accessor("api", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            API
            <ArrowDownUp className="size-3.5 opacity-70" aria-hidden />
          </button>
        ),
        cell: (info) => <span className="text-xs">{info.getValue()}</span>,
      }),
      columnHelper.accessor("ttft_ms", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            TTFT
            <ArrowDownUp className="size-3.5 opacity-70" aria-hidden />
          </button>
        ),
        cell: (info) => {
          const v = info.getValue();
          return <span className="font-mono text-xs">{v === null || v === undefined ? "—" : `${Math.round(v)} ms`}</span>;
        },
        sortingFn: "basic",
      }),
      columnHelper.accessor("tpot_ms", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            TPOT
            <ArrowDownUp className="size-3.5 opacity-70" aria-hidden />
          </button>
        ),
        cell: (info) => {
          const v = info.getValue();
          return <span className="font-mono text-xs">{v === null || v === undefined ? "—" : `${Math.round(v)} ms`}</span>;
        },
        sortingFn: "basic",
      }),
      columnHelper.accessor("pass", {
        header: "품질",
        cell: (info) => {
          const v = info.getValue();
          if (v === true) return <CircleCheck className="size-4 text-[var(--chart-pass)]" aria-label="pass" />;
          if (v === false) return <CircleX className="size-4 text-[var(--chart-fail)]" aria-label="fail" />;
          return <HelpCircle className="size-4 text-[var(--muted)]" aria-label="unknown" />;
        },
        enableSorting: false,
      }),
    ],
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: { sorting: [{ id: "scenario", desc: false }] },
  });

  if (!rows.length) {
    return <p className="text-sm text-[var(--muted)]">결과 행이 없습니다.</p>;
  }

  return (
    <div className="max-h-72 overflow-auto rounded border border-[var(--border)]">
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
    </div>
  );
}
