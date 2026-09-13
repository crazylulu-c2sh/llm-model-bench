import type { ColumnDef, RowData } from "@tanstack/react-table";
import { CircleX } from "lucide-react";
import { ModelLabel } from "./ModelLabel";

type PlaceholderKind = "model" | "scenario" | "unknown" | "metric" | "quality";
export type PlaceholderColumn = { meta: { resultPlaceholder: PlaceholderKind } };

/** Every result column must declare placeholder semantics beside its real cell.
 * Keep the column array `satisfies PlaceholderColumn[]` so omission is a type error.
 */
export function withResultPlaceholder<TData extends RowData, TValue>(
  column: ColumnDef<TData, TValue>,
  kind: PlaceholderKind,
): ColumnDef<TData, TValue> & PlaceholderColumn {
  return { ...column, meta: { ...column.meta, resultPlaceholder: kind } };
}

export function ResultPlaceholderCells({ columns, row, state, active, reasonLabel, unrunLabel }: {
  columns: readonly { id: string; columnDef: { meta?: unknown } }[];
  row: { model_id: string; scenario: string; api: string };
  state: "pending" | "skipped";
  active?: boolean;
  reasonLabel?: string;
  unrunLabel: string;
}) {
  return columns.map(column => {
    const kind = (column.columnDef.meta as PlaceholderColumn["meta"] | undefined)?.resultPlaceholder;
    if (!kind) throw new Error(`Missing result placeholder metadata: ${column.id}`);
    let content;
    switch (kind) {
      case "model":
        content = <>
          {active ? <span className="absolute inset-y-0 left-0 w-[3px] bg-[var(--accent)]" aria-hidden /> : null}
          <span className="whitespace-nowrap text-xs text-[var(--foreground)]">
            <ModelLabel modelId={row.model_id} size={14} className="max-w-[20rem]" />
          </span>
        </>;
        break;
      case "scenario":
        content = <span className="inline-flex min-w-0 flex-col leading-tight text-xs">
          <span className="truncate text-[10px] text-[var(--muted)]">{row.api}</span>
          <span className="font-mono text-[var(--foreground)]">{row.scenario}</span>
        </span>;
        break;
      case "quality":
        if (state === "skipped") {
          content = <span className="inline-flex items-center justify-center gap-1" title={reasonLabel}>
            <CircleX className="size-3.5 shrink-0 text-[var(--chart-fail)]" aria-hidden />
            <span className="text-xs text-[var(--foreground)]">{unrunLabel}</span>
          </span>;
          break;
        }
        // Pending quality uses the same placeholder as other measured values.
        content = <div className="h-3 w-12 animate-pulse rounded bg-[var(--border)]" />;
        break;
      case "metric":
        content = state === "pending"
          ? <div className="h-3 w-12 animate-pulse rounded bg-[var(--border)]" />
          : <span className="text-xs text-[var(--muted)]">—</span>;
        break;
      case "unknown":
        content = <span className="text-xs text-[var(--muted)]">—</span>;
        break;
      default: {
        const exhaustive: never = kind;
        throw new Error(`Unknown result placeholder kind: ${exhaustive}`);
      }
    }
    return <td key={column.id} data-column-id={column.id}
      className={`p-2 align-middle${column.id === "model_id" ? " relative" : ""}`}>
      {content}
    </td>;
  });
}
