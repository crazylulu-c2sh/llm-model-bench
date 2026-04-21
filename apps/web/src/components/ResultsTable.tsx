import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDownUp, CircleCheck, CircleX, HelpCircle } from "lucide-react";
import { useMemo } from "react";
import { MetricTableIntro } from "./MetricChartLegend";

export type ResultRow = {
  rowKey: string;
  model_id: string;
  scenario: string;
  api: string;
  ttft_ms: number | null;
  tpot_ms: number | null;
  /** 근사 초당 출력 토큰; 없으면 null */
  tps?: number | null;
  pass?: boolean;
  reason?: string;
};

const columnHelper = createColumnHelper<ResultRow>();

function apiHeaderTitle(api: string): string {
  if (api === "chat_completions") return "OpenAI 호환 chat completions 스타일 엔드포인트";
  if (api === "messages") return "Anthropic 스타일 messages 엔드포인트";
  return `API: ${api}`;
}

export function ResultsTable({
  rows,
  onRowClick,
}: {
  rows: ResultRow[];
  onRowClick?: (row: ResultRow) => void;
}) {
  const data = useMemo(() => rows, [rows]);

  const table = useReactTable({
    data,
    columns: [
      columnHelper.accessor("model_id", {
        header: () => (
          <span title="이 행 벤치에 사용된 모델 ID">모델</span>
        ),
        cell: (info) => <span className="whitespace-nowrap font-mono text-xs">{info.getValue()}</span>,
      }),
      columnHelper.accessor("scenario", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            title="벤치 시나리오 식별자"
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
            title="호출한 API 종류"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            API
            <ArrowDownUp className="size-3.5 opacity-70" aria-hidden />
          </button>
        ),
        cell: (info) => {
          const v = info.getValue();
          return (
            <span className="text-xs" title={apiHeaderTitle(v)}>
              {v}
            </span>
          );
        },
      }),
      columnHelper.accessor("ttft_ms", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            title="Time To First Token — 첫 출력 토큰이 나오기까지 걸린 시간(밀리초)"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            TTFT (ms)
            <ArrowDownUp className="size-3.5 opacity-70" aria-hidden />
          </button>
        ),
        cell: (info) => {
          const v = info.getValue();
          return (
            <span className="whitespace-nowrap font-mono text-xs">
              {v === null || v === undefined ? "—" : `${Math.round(v)}`}
            </span>
          );
        },
        sortingFn: "basic",
      }),
      columnHelper.accessor("tpot_ms", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            title="Time Per Output Token — 첫 토큰 이후 출력 토큰당 평균 시간(밀리초)"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            TPOT (ms)
            <ArrowDownUp className="size-3.5 opacity-70" aria-hidden />
          </button>
        ),
        cell: (info) => {
          const v = info.getValue();
          return (
            <span className="whitespace-nowrap font-mono text-xs">
              {v === null || v === undefined ? "—" : `${Math.round(v)}`}
            </span>
          );
        },
        sortingFn: "basic",
      }),
      columnHelper.accessor("tps", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            title="Tokens Per Second (근사) — 출력 텍스트 길이 기반 토큰 추정 ÷ 총 소요 시간(초)"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            TPS (tok/s)
            <ArrowDownUp className="size-3.5 opacity-70" aria-hidden />
          </button>
        ),
        cell: (info) => {
          const v = info.getValue();
          if (v === null || v === undefined) return <span className="whitespace-nowrap font-mono text-xs">—</span>;
          return <span className="whitespace-nowrap font-mono text-xs">{v}</span>;
        },
        sortingFn: (a, b) => {
          const x = a.original.tps ?? -1;
          const y = b.original.tps ?? -1;
          return x - y;
        },
      }),
      columnHelper.accessor("pass", {
        header: () => <span title="시나리오별 품질 스코어(합격/불합격)">품질</span>,
        cell: (info) => {
          const v = info.getValue();
          if (v === true) {
            return (
              <span className="inline-flex items-center gap-1.5">
                <CircleCheck className="size-4 shrink-0 text-[var(--chart-pass)]" aria-hidden />
                <span className="text-xs text-[var(--foreground)]">합격</span>
              </span>
            );
          }
          if (v === false) {
            return (
              <span className="inline-flex items-center gap-1.5">
                <CircleX className="size-4 shrink-0 text-[var(--chart-fail)]" aria-hidden />
                <span className="text-xs text-[var(--foreground)]">불합격</span>
              </span>
            );
          }
          return (
            <span className="inline-flex items-center gap-1.5">
              <HelpCircle className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
              <span className="text-xs text-[var(--muted)]">—</span>
            </span>
          );
        },
        enableSorting: false,
      }),
    ],
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (r) => r.rowKey,
    initialState: { sorting: [{ id: "scenario", desc: false }] },
  });

  return (
    <div>
      <MetricTableIntro />
      {!rows.length ? (
        <p className="text-sm text-[var(--muted)]">결과 행이 없습니다.</p>
      ) : (
        <div className="max-h-[min(60vh,32rem)] overflow-auto rounded border border-[var(--border)]">
          <table className="w-full min-w-[36rem] text-left text-sm">
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
                <tr
                  key={row.id}
                  className={`border-t border-[var(--border)] ${onRowClick ? "cursor-pointer hover:bg-[var(--surface)]" : ""}`}
                  onClick={() => onRowClick?.(row.original)}
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
          {onRowClick ? (
            <p className="border-t border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted)]">
              행을 클릭하면 프롬프트·출력 상세를 볼 수 있습니다.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
