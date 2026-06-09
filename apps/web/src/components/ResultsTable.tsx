import { isVisionScenario, scenarioExecutionOrderIndex, scoreToRubric } from "@llm-bench/shared";
import { apiRouteRank } from "./chart-types";
import { compareModelIdAlphanumeric } from "../lib/model-sort";
import { buildModelColorMap } from "../lib/model-color";
import { computeGroupWinners } from "../lib/result-winners";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type Column,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { AlertTriangle, ArrowDown, ArrowDownUp, ArrowUp, CircleCheck, CircleX, HelpCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { MetricTableIntro } from "./MetricChartLegend";

export type ResultRow = {
  rowKey: string;
  model_id: string;
  scenario: string;
  api: string;
  ttft_ms: number | null;
  /** 초당 출력 토큰(usage 실토큰 또는 글자수/4 근사); 없으면 null */
  tps?: number | null;
  /** TPS 산정에 provider 실토큰을 썼는지 — "approx"면 `*`·경고 표기 */
  tps_source?: "usage" | "approx";
  /** messages 라우트에서 추론이 숨겨진 채 측정됨 → TTFT 비교 주의 배지 */
  reasoning_hidden?: boolean;
  pass?: boolean;
  /** 0~1 점수. 비전 시나리오에서 rubric 0~3과 함께 표시. 텍스트 시나리오는 보통 0 또는 1. */
  score?: number;
  reason?: string;
};

type PendingSkeletonRow = { rowKey: string; model_id: string; scenario: string; api: string };

const columnHelper = createColumnHelper<ResultRow>();

function apiHeaderTitle(api: string): string {
  if (api === "chat_completions") return "OpenAI 호환 chat completions 스타일 엔드포인트";
  if (api === "messages") return "Anthropic 스타일 messages 엔드포인트";
  return `API: ${api}`;
}

function sortDirIcon(column: Column<ResultRow, unknown>) {
  const s = column.getIsSorted();
  if (s === "asc") return <ArrowUp className="size-3.5 shrink-0 opacity-90" aria-hidden />;
  if (s === "desc") return <ArrowDown className="size-3.5 shrink-0 opacity-90" aria-hidden />;
  return <ArrowDownUp className="size-3.5 shrink-0 opacity-45" aria-hidden />;
}

const RESULT_SORT_LABELS: Record<string, string> = {
  model_id: "모델",
  scenario: "시나리오",
  api: "API",
  ttft_ms: "TTFT (ms)",
  tps: "TPS (tok/s)",
};

function resultsSortLine(sorting: SortingState): string {
  if (sorting.length === 0) return "현재 정렬: 없음";
  const dirOf = (desc: boolean) => (desc ? "내림차순" : "오름차순");
  const allSameDir = sorting.every((s) => s.desc === sorting[0]!.desc);
  if (allSameDir) {
    const chain = sorting.map((s) => RESULT_SORT_LABELS[s.id] ?? s.id).join(" → ");
    return `현재 정렬: ${chain} · ${dirOf(sorting[0]!.desc)}`;
  }
  const chain = sorting
    .map((s) => `${RESULT_SORT_LABELS[s.id] ?? s.id}(${dirOf(s.desc)})`)
    .join(" → ");
  return `현재 정렬: ${chain}`;
}

export function ResultsTable({
  rows,
  pendingRows = [],
  maxRows,
  onRowClick,
}: {
  rows: ResultRow[];
  pendingRows?: PendingSkeletonRow[];
  /** 이 수를 초과하면 카드 내부 스크롤 활성화 */
  maxRows?: number;
  onRowClick?: (row: ResultRow) => void;
}) {
  // 기본 정렬과 동일한 키(모델 → 시나리오 실행 순서 → API)로 베이스 행을 미리 정렬한다.
  // 단일 컬럼(예: 모델) 정렬 시 동률 행의 안정 정렬 폴백이 항상 실행 순서를 따르도록 해
  // "모델 순"과 "시나리오 순"의 시나리오 배열이 일치하게 만든다.
  const data = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          compareModelIdAlphanumeric(a.model_id, b.model_id) ||
          scenarioExecutionOrderIndex(a.scenario) - scenarioExecutionOrderIndex(b.scenario) ||
          apiRouteRank(a.api) - apiRouteRank(b.api) ||
          a.api.localeCompare(b.api),
      ),
    [rows],
  );
  const hasApproxTps = useMemo(
    () => rows.some((r) => r.tps != null && r.tps_source === "approx"),
    [rows],
  );
  const hasReasoningHidden = useMemo(() => rows.some((r) => r.reasoning_hidden), [rows]);
  // 모델별 안정 색 + (시나리오·API) 그룹 내 메트릭 최우수 행. 정렬과 무관하게 원본 rows 기준.
  const colorByModel = useMemo(() => buildModelColorMap(rows.map((r) => r.model_id)), [rows]);
  const winners = useMemo(
    () =>
      computeGroupWinners(
        rows.map((r) => ({
          rowKey: r.rowKey,
          model_id: r.model_id,
          scenario: r.scenario,
          api: r.api,
          ttft_ms: r.ttft_ms,
          tps: r.tps,
        })),
      ),
    [rows],
  );
  // 모델이 2개 이상일 때만 색 구별을 적용(단일 모델 테이블은 그대로).
  const multiModel = colorByModel.size >= 2;
  const [sorting, setSorting] = useState<SortingState>([
    { id: "model_id", desc: false },
    { id: "scenario", desc: false },
    { id: "api", desc: false },
  ]);

  const table = useReactTable({
    data,
    state: { sorting },
    onSortingChange: setSorting,
    columns: [
      columnHelper.accessor("model_id", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            title="이 행 벤치에 사용된 모델 ID"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            모델
            {sortDirIcon(column)}
          </button>
        ),
        cell: (info) => {
          const c = colorByModel.get(info.getValue());
          return (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-xs">
              {multiModel && c ? (
                <span className="size-2 shrink-0 rounded-full" style={{ background: c }} aria-hidden />
              ) : null}
              {info.getValue()}
            </span>
          );
        },
        sortingFn: "alphanumeric",
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
            {sortDirIcon(column)}
          </button>
        ),
        cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
        sortingFn: (a, b) => {
          const d = scenarioExecutionOrderIndex(a.original.scenario) - scenarioExecutionOrderIndex(b.original.scenario);
          if (d !== 0) return d;
          return a.original.scenario.localeCompare(b.original.scenario);
        },
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
            {sortDirIcon(column)}
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
        sortingFn: (a, b) => {
          const d = apiRouteRank(a.original.api) - apiRouteRank(b.original.api);
          if (d !== 0) return d;
          return a.original.api.localeCompare(b.original.api);
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
            {sortDirIcon(column)}
          </button>
        ),
        cell: ({ row, getValue }) => {
          const v = getValue();
          const win = winners.get(row.original.rowKey)?.ttft ?? false;
          return (
            <span
              className={`inline-flex items-center gap-1 whitespace-nowrap font-mono text-xs${win ? " font-bold" : ""}`}
              style={win ? { color: "var(--dir-lower)" } : undefined}
              title={win ? "이 시나리오·API 그룹에서 가장 빠른 TTFT" : undefined}
            >
              {win ? <span aria-hidden>▾</span> : null}
              {v === null || v === undefined ? "—" : `${Math.round(v)}`}
              {row.original.reasoning_hidden ? (
                <span
                  className="inline-flex items-center text-amber-500"
                  title="추론 숨김 — TTFT는 첫 가시 토큰까지(숨은 추론 포함)라 다른 라우트와 비교 주의"
                  aria-label="추론 숨김 — TTFT 비교 주의"
                >
                  <AlertTriangle className="size-3 shrink-0" aria-hidden />
                </span>
              ) : null}
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
            {sortDirIcon(column)}
          </button>
        ),
        cell: ({ row, getValue }) => {
          const v = getValue();
          if (v === null || v === undefined) return <span className="whitespace-nowrap font-mono text-xs">—</span>;
          const approx = row.original.tps_source === "approx";
          const win = winners.get(row.original.rowKey)?.tps ?? false;
          return (
            <span
              className={`whitespace-nowrap font-mono text-xs${win ? " font-bold" : ""}`}
              style={win ? { color: "var(--dir-higher)" } : undefined}
              title={
                win
                  ? "이 시나리오·API 그룹에서 가장 높은 TPS"
                  : approx
                    ? "provider가 usage 토큰 수를 안 줘서 글자수/4 추정치로 계산(approx). CJK·코드에서 오차 큼."
                    : "provider 보고 실토큰 기반(usage)"
              }
            >
              {win ? <span aria-hidden className="mr-0.5">▴</span> : null}
              {v}
              {approx ? <span className="text-[var(--muted)]">*</span> : null}
            </span>
          );
        },
        sortingFn: (a, b) => {
          const x = a.original.tps ?? -1;
          const y = b.original.tps ?? -1;
          return x - y;
        },
      }),
      columnHelper.display({
        id: "quality",
        header: () => (
          <span title="텍스트 시나리오는 합격/불합격 이진. 비전 시나리오는 rubric 0~3(score 0/0.33/0.67/1), rubric ≥ 2 가 통과.">
            품질
          </span>
        ),
        cell: ({ row }) => {
          const { pass, score, scenario } = row.original;
          const vision = isVisionScenario(scenario);

          if (vision && typeof score === "number") {
            const rubric = scoreToRubric(score);
            // 색상 토큰 — 4단계: 3/2 = pass 톤, 0 = fail 톤, 1 = muted (부분 인식).
            const colorClass =
              rubric === 3 || rubric === 2
                ? "text-[var(--chart-pass)] border-[var(--chart-pass)]"
                : rubric === 0
                  ? "text-[var(--chart-fail)] border-[var(--chart-fail)]"
                  : "text-[var(--muted)] border-[var(--border)]";
            const rubricLabel = rubric ?? "?";
            const passLabel = pass ? "통과" : "미통과";
            return (
              <span
                className={`inline-flex items-center gap-1.5 rounded border bg-[var(--surface)] px-1.5 py-0.5 ${colorClass}`}
                aria-label={`루브릭 ${rubricLabel}/3, score ${score.toFixed(2)}, ${passLabel}`}
                title={`rubric ${rubricLabel}/3 · score ${score.toFixed(2)} · ${passLabel}`}
              >
                <span className="font-mono text-xs">{rubricLabel}/3</span>
                <span className="text-[10px] text-[var(--muted)]">·</span>
                <span className="font-mono text-xs">{score.toFixed(2)}</span>
              </span>
            );
          }

          if (pass === true) {
            return (
              <span className="inline-flex items-center gap-1.5">
                <CircleCheck className="size-4 shrink-0 text-[var(--chart-pass)]" aria-hidden />
                <span className="text-xs text-[var(--foreground)]">합격</span>
              </span>
            );
          }
          if (pass === false) {
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
  });

  const hasPending = pendingRows.length > 0;
  const hasRows = rows.length > 0;
  const totalRows = table.getRowModel().rows.length + pendingRows.length;
  const shouldScroll = maxRows != null && totalRows > maxRows;

  return (
    <div>
      <MetricTableIntro />
      {hasRows ? <p className="mb-2 text-xs text-[var(--muted)]">{resultsSortLine(sorting)}</p> : null}
      {!hasRows && !hasPending ? (
        <p className="text-sm text-[var(--muted)]">결과 행이 없습니다.</p>
      ) : (
        <div
          className={`rounded border border-[var(--border)]${shouldScroll ? " overflow-auto" : ""}`}
          style={shouldScroll ? { maxHeight: `calc(${maxRows + 2} * 2.25rem)` } : undefined}
        >
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-[var(--surface)] text-[var(--muted)]">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className={`p-2${shouldScroll ? " sticky top-0 z-[1] bg-[var(--surface)]" : ""}`}>
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const barColor = multiModel ? colorByModel.get(row.original.model_id) : undefined;
                return (
                  <tr
                    key={row.id}
                    className={`border-t border-[var(--border)] ${onRowClick ? "cursor-pointer hover:bg-[var(--surface)]" : ""}`}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell, ci) => (
                      <td
                        key={cell.id}
                        className={`p-2 align-middle${ci === 0 ? " relative" : ""}`}
                      >
                        {ci === 0 && barColor ? (
                          <span
                            className="absolute inset-y-0 left-0 w-[3px]"
                            style={{ background: barColor }}
                            aria-hidden
                          />
                        ) : null}
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {pendingRows.map((pr) => (
                <tr
                  key={pr.rowKey}
                  className="border-t border-[var(--border)] opacity-40"
                  aria-hidden="true"
                >
                  <td className="p-2">
                    <span className="whitespace-nowrap font-mono text-xs text-[var(--muted)]">{pr.model_id}</span>
                  </td>
                  <td className="p-2">
                    <span className="font-mono text-xs text-[var(--muted)]">{pr.scenario}</span>
                  </td>
                  <td className="p-2">
                    <span className="text-xs text-[var(--muted)]">{pr.api}</span>
                  </td>
                  <td className="p-2"><div className="h-3 w-10 animate-pulse rounded bg-[var(--border)]" /></td>
                  <td className="p-2"><div className="h-3 w-10 animate-pulse rounded bg-[var(--border)]" /></td>
                  <td className="p-2"><div className="h-3 w-12 animate-pulse rounded bg-[var(--border)]" /></td>
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
      {hasReasoningHidden ? (
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
          <span className="text-amber-500">⚠</span> 표시 행은 <code className="font-mono">messages</code> 라우트에서 추론이 숨겨진 채 측정됐습니다 — TTFT가 "첫 가시 토큰까지(숨은 추론 포함)"라 chat_completions·사고 OFF와 직접 비교하면 부풀려 보입니다. TPS는 provider 실토큰으로 보정됩니다.
        </p>
      ) : null}
      {hasApproxTps ? (
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
          <code className="font-mono">*</code> TPS는 provider가 usage 토큰 수를 보고하지 않아 <code className="font-mono">chars/4</code> 추정치(approx)로 계산됐습니다 — CJK·코드 응답에서 오차가 큽니다.
        </p>
      ) : null}
    </div>
  );
}
