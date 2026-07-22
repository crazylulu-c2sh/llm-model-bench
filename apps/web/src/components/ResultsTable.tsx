import { formatTtftMs, isVisionScenario, scenarioExecutionOrderIndex, scoreToRubric } from "@llm-bench/shared";
import { apiRouteRank } from "./chart-types";
import { compareModelBenchQueueOrder, compareStringsPinned } from "../lib/model-sort";
import { buildModelColorMap } from "../lib/model-color";
import { ModelLabel } from "./ModelLabel";
import { computeGroupWinners } from "../lib/result-winners";
import {
  BENCH_EXECUTION_SORT,
  cycleColumnSort,
  isBenchExecutionSort,
  resultsSortLine,
} from "../lib/results-table-sort";
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
import { useCallback, useMemo, useState } from "react";
import { MetricTableIntro } from "./MetricChartLegend";
import { useI18n, type Messages } from "../i18n";

export type ResultRow = {
  rowKey: string;
  model_id: string;
  scenario: string;
  api: string;
  ttft_ms: number | null;
  /** TPS·출력 토큰 산정에 쓴 토큰 수(usage 실토큰 또는 글자수/4 근사); 없으면 null */
  output_tokens?: number | null;
  /** 초당 출력 토큰(usage 실토큰 또는 글자수/4 근사); 없으면 null */
  tps?: number | null;
  /** TPS·출력 토큰 산정에 provider 실토큰을 썼는지 — "approx"면 `*`·경고 표기 */
  tps_source?: "usage" | "approx";
  /** messages 라우트에서 추론이 숨겨진 채 측정됨 → TTFT 비교 주의 배지 */
  reasoning_hidden?: boolean;
  /** #1922: 스트리밍 tool_call 인자 연결 손상 → LM Studio 엔진 프로토콜 회귀 의심 배지 */
  tool_call_args_corrupted?: boolean;
  /** chat 라우트에서 추론이 content로 새어 들어옴 → 엔진 프로토콜 회귀 의심 배지 */
  reasoning_leaked_into_content?: boolean;
  /** #80: 가시 content에 <think>/<|channel|> 태그 잔존(라우트 무관) → 추론 누수 배지의 일반화 신호 */
  channel_tag_leak_detected?: boolean;
  /** #105: agent_loop 마지막 측정 런의 종료 사유(에이전트 컬럼 배지). */
  agent_completion_reason?: "completed" | "stall" | "budget_exhausted";
  /** #105: agent_loop 완료까지 턴 수(완료 배지 부제). */
  turns_to_completion?: number | null;
  /** #105: agent_loop 빈 턴 수. */
  empty_turn_count?: number;
  /** #105: 사고가 예산을 소진해 빈 턴이 있었는지(예산소진 툴팁). */
  thinking_exhausted_budget?: boolean;
  pass?: boolean;
  /** 0~1 점수. 비전 시나리오에서 rubric 0~3과 함께 표시. 텍스트 시나리오는 보통 0 또는 1. */
  score?: number;
  reason?: string;
};

type PendingSkeletonRow = { rowKey: string; model_id: string; scenario: string; api: string };

// 안정적 기본값: `= []` 기본 파라미터는 매 렌더 새 배열을 만들어 `data` useMemo(및 TanStack에
// 넘기는 data 참조)를 매 렌더 바꿔 무한 재렌더 루프를 유발한다(모델 2개 선택 시 먹통). 모듈 상수로 고정.
const EMPTY_MODEL_ORDER: string[] = [];
const EMPTY_PENDING_ROWS: PendingSkeletonRow[] = [];

const columnHelper = createColumnHelper<ResultRow>();

function apiHeaderTitle(api: string, m: Messages): string {
  if (api === "chat_completions") return m.results.table.apiTitleChat;
  if (api === "messages") return m.results.table.apiTitleMessages;
  return `API: ${api}`;
}

function sortDirIcon(column: Column<ResultRow, unknown>, sorting: SortingState) {
  if (isBenchExecutionSort(sorting)) {
    return <ArrowDownUp className="size-3.5 shrink-0 opacity-45" aria-hidden />;
  }
  const s = column.getIsSorted();
  if (s === "asc") return <ArrowUp className="size-3.5 shrink-0 opacity-90" aria-hidden />;
  if (s === "desc") return <ArrowDown className="size-3.5 shrink-0 opacity-90" aria-hidden />;
  return <ArrowDownUp className="size-3.5 shrink-0 opacity-45" aria-hidden />;
}

export function ResultsTable({
  rows,
  pendingRows = EMPTY_PENDING_ROWS,
  maxRows,
  benchModelOrder = EMPTY_MODEL_ORDER,
  onRowClick,
}: {
  rows: ResultRow[];
  pendingRows?: PendingSkeletonRow[];
  /** 이 수를 초과하면 카드 내부 스크롤 활성화 */
  maxRows?: number;
  /** 벤치 큐 순서 — 미전달 시 모델 ID alphanumeric 폴백 */
  benchModelOrder?: string[];
  onRowClick?: (row: ResultRow) => void;
}) {
  const { m } = useI18n();
  const modelQueue = benchModelOrder;
  // 내용 기반 키: 호출부가 매 렌더 새 배열(예: benchQueueDraft.map(...))을 넘겨도 `data` 참조가
  // 바뀌지 않도록 한다. 불안정한 `data`는 TanStack에 매 렌더 새 참조로 전달돼 무한 재렌더(먹통)를 유발.
  const modelQueueKey = modelQueue.join("\0");
  // 기본 정렬과 동일한 키(모델 큐 → 시나리오 실행 순서 → API)로 베이스 행을 미리 정렬한다.
  const data = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          compareModelBenchQueueOrder(a.model_id, b.model_id, modelQueue) ||
          scenarioExecutionOrderIndex(a.scenario) - scenarioExecutionOrderIndex(b.scenario) ||
          apiRouteRank(a.api) - apiRouteRank(b.api) ||
          compareStringsPinned(a.api, b.api),
      ),
    // modelQueue 대신 내용 키를 dep으로 사용(참조 불안정성 차단).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, modelQueueKey],
  );
  const hasApproxTps = useMemo(
    () => rows.some((r) => r.tps != null && r.tps_source === "approx"),
    [rows],
  );
  const hasReasoningHidden = useMemo(() => rows.some((r) => r.reasoning_hidden), [rows]);
  const hasEngineProtocolWarning = useMemo(
    () =>
      rows.some(
        (r) => r.tool_call_args_corrupted || r.channel_tag_leak_detected || r.reasoning_leaked_into_content,
      ),
    [rows],
  );
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
  const multiModel = colorByModel.size >= 2;
  // #105: 에이전트(멀티턴) 런이 하나라도 있을 때만 에이전트 컬럼 표출 — 비-에이전트 벤치 오염 방지.
  const anyAgentRow = useMemo(() => rows.some((r) => r.agent_completion_reason != null), [rows]);
  const [sorting, setSorting] = useState<SortingState>(BENCH_EXECUTION_SORT);

  const onColumnSort = useCallback((columnId: string) => {
    setSorting((prev) => cycleColumnSort(columnId, prev));
  }, []);

  const modelSortFn = useCallback(
    (a: { original: ResultRow }, b: { original: ResultRow }) =>
      compareModelBenchQueueOrder(a.original.model_id, b.original.model_id, modelQueue),
    // 참조 대신 내용 키 사용(위 data와 동일 이유).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelQueueKey],
  );

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
            title={m.results.table.colModelTitle}
            onClick={() => onColumnSort(column.id)}
          >
            {m.results.table.colModel}
            {sortDirIcon(column, sorting)}
          </button>
        ),
        cell: (info) => {
          const c = colorByModel.get(info.getValue());
          return (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
              {multiModel && c ? (
                <span className="size-2 shrink-0 rounded-full" style={{ background: c }} aria-hidden />
              ) : null}
              <ModelLabel modelId={info.getValue()} showQuant size={14} />
            </span>
          );
        },
        sortingFn: modelSortFn,
      }),
      columnHelper.accessor("scenario", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            title={m.results.table.colScenarioTitle}
            onClick={() => onColumnSort(column.id)}
          >
            {m.results.table.colScenario}
            {sortDirIcon(column, sorting)}
          </button>
        ),
        cell: (info) => {
          const r = info.row.original;
          const corrupted = r.tool_call_args_corrupted === true;
          // #80: 배지의 "추론 누수"를 일반화된 channel_tag_leak(라우트 무관)로 구동. 구버전 런 호환을 위해
          // 기존 reasoning_leaked_into_content(LM Studio 0.4.14–0.4.18 버그 신호)를 OR 폴백으로 유지.
          const leaked = r.channel_tag_leak_detected === true || r.reasoning_leaked_into_content === true;
          const contaminated = corrupted || leaked;
          const detail = [
            corrupted ? m.results.toolArgsCorrupted : null,
            leaked ? m.results.reasoningLeak : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <span className="inline-flex items-center gap-1 font-mono text-xs">
              {info.getValue()}
              {contaminated ? (
                <span
                  className="inline-flex items-center text-amber-500"
                  title={m.results.table.contaminatedTitle(detail)}
                  aria-label={m.results.table.contaminatedAria(detail)}
                >
                  <AlertTriangle className="size-3 shrink-0" aria-hidden />
                </span>
              ) : null}
            </span>
          );
        },
        sortingFn: (a, b) => {
          const d = scenarioExecutionOrderIndex(a.original.scenario) - scenarioExecutionOrderIndex(b.original.scenario);
          if (d !== 0) return d;
          return compareStringsPinned(a.original.scenario, b.original.scenario);
        },
      }),
      columnHelper.accessor("api", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            title={m.results.table.colApiTitle}
            onClick={() => onColumnSort(column.id)}
          >
            API
            {sortDirIcon(column, sorting)}
          </button>
        ),
        cell: (info) => {
          const v = info.getValue();
          return (
            <span className="text-xs" title={apiHeaderTitle(v, m)}>
              {v}
            </span>
          );
        },
        sortingFn: (a, b) => {
          const d = apiRouteRank(a.original.api) - apiRouteRank(b.original.api);
          if (d !== 0) return d;
          return compareStringsPinned(a.original.api, b.original.api);
        },
      }),
      columnHelper.accessor("ttft_ms", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            title={m.results.table.colTtftTitle}
            onClick={() => onColumnSort(column.id)}
          >
            TTFT (ms)
            {sortDirIcon(column, sorting)}
          </button>
        ),
        cell: ({ row, getValue }) => {
          const v = getValue();
          const win = winners.get(row.original.rowKey)?.ttft ?? false;
          return (
            <span
              className={`inline-flex items-center gap-1 whitespace-nowrap font-mono text-xs${win ? " font-bold" : ""}`}
              style={win ? { color: "var(--dir-lower)" } : undefined}
              title={win ? m.results.table.ttftWinTitle : undefined}
            >
              {win ? <span aria-hidden>▾</span> : null}
              {formatTtftMs(v)}
              {row.original.reasoning_hidden ? (
                <span
                  className="inline-flex items-center text-amber-500"
                  title={m.results.table.reasoningHiddenTitle}
                  aria-label={m.results.table.reasoningHiddenAria}
                >
                  <AlertTriangle className="size-3 shrink-0" aria-hidden />
                </span>
              ) : null}
            </span>
          );
        },
        sortingFn: "basic",
      }),
      columnHelper.accessor("output_tokens", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            title={m.results.table.colOutputTokensTitle}
            onClick={() => onColumnSort(column.id)}
          >
            {m.results.table.colOutputTokens}
            {sortDirIcon(column, sorting)}
          </button>
        ),
        cell: ({ row, getValue }) => {
          const v = getValue();
          if (v === null || v === undefined) {
            return <span className="whitespace-nowrap font-mono text-xs">—</span>;
          }
          const approx = row.original.tps_source === "approx";
          return (
            <span
              className="whitespace-nowrap font-mono text-xs"
              title={
                approx
                  ? m.results.table.outputTokensApproxTitle
                  : m.results.table.outputTokensUsageTitle
              }
            >
              {v}
              {approx ? <span className="text-[var(--muted)]">*</span> : null}
            </span>
          );
        },
        sortingFn: (a, b) => {
          const x = a.original.output_tokens ?? -1;
          const y = b.original.output_tokens ?? -1;
          return x - y;
        },
      }),
      columnHelper.accessor("tps", {
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            title={m.results.table.colTpsTitle}
            onClick={() => onColumnSort(column.id)}
          >
            TPS (tok/s)
            {sortDirIcon(column, sorting)}
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
                  ? m.results.table.tpsWinTitle
                  : approx
                    ? m.results.table.tpsApproxTitle
                    : m.results.table.tpsUsageTitle
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
          <span title={m.results.table.colQualityTitle}>
            {m.results.table.colQuality}
          </span>
        ),
        cell: ({ row }) => {
          const { pass, score, scenario } = row.original;
          const vision = isVisionScenario(scenario);

          if (vision && typeof score === "number") {
            const rubric = scoreToRubric(score);
            const colorClass =
              rubric === 3 || rubric === 2
                ? "text-[var(--chart-pass)] border-[var(--chart-pass)]"
                : rubric === 0
                  ? "text-[var(--chart-fail)] border-[var(--chart-fail)]"
                  : "text-[var(--muted)] border-[var(--border)]";
            const rubricLabel = rubric ?? "?";
            const passLabel = pass ? m.results.pass : m.results.notPass;
            return (
              <span
                className={`inline-flex items-center gap-1.5 rounded border bg-[var(--surface)] px-1.5 py-0.5 ${colorClass}`}
                aria-label={m.results.table.qualityVisionAria(rubricLabel, score.toFixed(2), passLabel)}
                title={m.results.table.qualityVisionTitle(rubricLabel, score.toFixed(2), passLabel)}
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
                <span className="text-xs text-[var(--foreground)]">{m.results.passBadge}</span>
              </span>
            );
          }
          if (pass === false) {
            return (
              <span className="inline-flex items-center gap-1.5">
                <CircleX className="size-4 shrink-0 text-[var(--chart-fail)]" aria-hidden />
                <span className="text-xs text-[var(--foreground)]">{m.results.failBadge}</span>
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
      ...(anyAgentRow
        ? [
            columnHelper.display({
              id: "agent",
              header: () => (
                <span title={m.results.table.colAgentTitle}>
                  {m.results.table.colAgent}
                </span>
              ),
              cell: ({ row }) => {
                const { agent_completion_reason, turns_to_completion, empty_turn_count, thinking_exhausted_budget } =
                  row.original;
                if (agent_completion_reason == null) return <span className="text-xs text-[var(--muted)]">—</span>;
                if (agent_completion_reason === "completed") {
                  return (
                    <span
                      className="inline-flex items-center gap-1 rounded border border-[var(--chart-pass)] bg-[var(--surface)] px-1.5 py-0.5 text-xs text-[var(--chart-pass)]"
                      title={m.results.table.agentCompletedTitle(turns_to_completion ?? "?")}
                    >
                      {m.results.table.agentCompleted}{" "}
                      <span className="font-mono text-[10px] text-[var(--muted)]">
                        {m.results.table.agentTurns(turns_to_completion ?? "?")}
                      </span>
                    </span>
                  );
                }
                const isBudget = agent_completion_reason === "budget_exhausted";
                const label = isBudget ? m.results.table.agentBudget : m.results.table.agentStall;
                const colorClass = isBudget
                  ? "text-[var(--chart-fail)] border-[var(--chart-fail)]"
                  : "text-[var(--tier-okay)] border-[var(--tier-okay)]";
                const title =
                  (isBudget ? m.results.table.agentBudgetTitle : m.results.table.agentStallTitle) +
                  (thinking_exhausted_budget ? m.results.table.agentThinkingExhausted : "") +
                  (empty_turn_count ? m.results.table.agentEmptyTurns(empty_turn_count) : "");
                return (
                  <span
                    className={`inline-flex items-center gap-1 rounded border bg-[var(--surface)] px-1.5 py-0.5 text-xs ${colorClass}`}
                    title={title}
                  >
                    {label}
                    {thinking_exhausted_budget ? <span className="text-[10px]">⚠</span> : null}
                  </span>
                );
              },
              enableSorting: false,
            }),
          ]
        : []),
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
      {hasRows ? <p className="mb-2 text-xs text-[var(--muted)]">{resultsSortLine(sorting, m.results.sort)}</p> : null}
      {!hasRows && !hasPending ? (
        <p className="text-sm text-[var(--muted)]">{m.results.table.noRows}</p>
      ) : (
        <div
          className={`rounded border border-[var(--border)]${shouldScroll ? " overflow-auto" : ""}`}
          style={shouldScroll ? { maxHeight: `calc(${maxRows + 2} * 2.25rem)` } : undefined}
        >
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">{m.results.table.caption}</caption>
            <thead className="bg-[var(--surface)] text-[var(--muted)]">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const sorted = isBenchExecutionSort(sorting) ? false : h.column.getIsSorted();
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
                        className={`p-2${shouldScroll ? " sticky top-0 z-[1] bg-[var(--surface)]" : ""}`}
                      >
                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const barColor = multiModel ? colorByModel.get(row.original.model_id) : undefined;
                return (
                  <tr
                    key={row.id}
                    className={`border-t border-[var(--border)] ${onRowClick ? "cursor-pointer hover:bg-[var(--surface)] focus-visible:bg-[var(--surface-2)]" : ""}`}
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-label={
                      onRowClick
                        ? m.results.table.rowOpenAria(row.original.model_id, row.original.scenario)
                        : undefined
                    }
                    onClick={() => onRowClick?.(row.original)}
                    onKeyDown={(e) => {
                      if (!onRowClick) return;
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      onRowClick(row.original);
                    }}
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
                    <span className="whitespace-nowrap text-xs text-[var(--muted)]">
                      <ModelLabel modelId={pr.model_id} size={14} />
                    </span>
                  </td>
                  <td className="p-2">
                    <span className="font-mono text-xs text-[var(--muted)]">{pr.scenario}</span>
                  </td>
                  <td className="p-2">
                    <span className="text-xs text-[var(--muted)]">{pr.api}</span>
                  </td>
                  <td className="p-2"><div className="h-3 w-10 animate-pulse rounded bg-[var(--border)]" /></td>
                  <td className="p-2"><div className="h-3 w-8 animate-pulse rounded bg-[var(--border)]" /></td>
                  <td className="p-2"><div className="h-3 w-10 animate-pulse rounded bg-[var(--border)]" /></td>
                  <td className="p-2"><div className="h-3 w-12 animate-pulse rounded bg-[var(--border)]" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {onRowClick ? (
            <p className="border-t border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted)]">
              {m.results.table.rowClickHint}
            </p>
          ) : null}
        </div>
      )}
      {hasReasoningHidden ? (
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
          <span className="text-amber-500">⚠</span> {m.results.table.reasoningHiddenNoteLead}
          <code className="font-mono">messages</code>
          {m.results.table.reasoningHiddenNoteTail}
        </p>
      ) : null}
      {hasApproxTps ? (
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
          <code className="font-mono">*</code>
          {m.results.table.approxNoteMid}
          <code className="font-mono">chars/4</code>
          {m.results.table.approxNoteTail}
        </p>
      ) : null}
      {hasEngineProtocolWarning ? (
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
          <span className="text-amber-500">⚠</span> {m.results.table.engineWarnLead}
          <strong>{m.results.toolArgsCorrupted}</strong>
          {m.results.table.engineWarnOr}
          <strong>{m.results.reasoningLeak}</strong>
          {m.results.table.engineWarnMid}
          <a
            className="underline"
            href="/profile#lmstudio-host"
            target="_blank"
            rel="noreferrer"
            title={m.results.newWindowTitle}
          >
            {m.results.actionGuide}
            <span className="sr-only">{m.results.newWindowSuffix}</span>
          </a>
          {m.results.table.engineWarnTail}
        </p>
      ) : null}
    </div>
  );
}
