import type { DetectResult, LlmProfileFamily, SamplingPresetName } from "@llm-bench/shared";
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
import { ModelLabel } from "./ModelLabel";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n, msg, type Messages } from "../i18n";
import { ConfirmDialog } from "./ConfirmDialog";

export type ProfileHint = { family: LlmProfileFamily; preset: SamplingPresetName };

function ProfileHintCell({
  hint,
  onRequestLeave,
}: {
  hint?: ProfileHint;
  onRequestLeave: (hash: string) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  if (!hint) {
    return (
      <span className="block max-w-[14rem] truncate font-mono text-[10px] leading-tight text-[var(--muted)]">—</span>
    );
  }
  const onProfile = location.pathname === "/profile";
  const handle = (hash: string) => (e: ReactMouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation();
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (onProfile) navigate({ pathname: "/profile", hash });
    else onRequestLeave(hash);
  };
  const linkCls =
    "text-[var(--muted)] underline-offset-2 hover:text-[var(--accent-2)] hover:underline focus:outline-none focus:underline";
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- 행 토글로의 mousedown 전파 차단 가드일 뿐 상호작용 아님
    <span
      className="block max-w-[14rem] truncate font-mono text-[10px] leading-tight"
      title={`${hint.family} · ${hint.preset}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <a
        href={`/profile#${hint.family}`}
        onClick={handle(`#${hint.family}`)}
        className={linkCls}
      >
        {hint.family}
      </a>
      <span className="text-[var(--muted)]"> · </span>
      <a
        href={`/profile#preset-${hint.preset}`}
        onClick={handle(`#preset-${hint.preset}`)}
        className={linkCls}
      >
        {hint.preset}
      </a>
    </span>
  );
}

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

function modelTableSortLine(sorting: SortingState, b: Messages["bench"]): string {
  const first = sorting[0];
  if (!first) return b.sortNone;
  const name = b.sortLabels[first.id] ?? first.id;
  const dir = first.desc ? b.sortDesc : b.sortAsc;
  return b.sortLine(name, dir);
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
  benchActiveModelId = null,
  benchRunning = false,
}: {
  models: DetectResult["models"];
  selected: Record<string, boolean>;
  onToggle: (id: string) => void;
  onSelectAll: (next: boolean, ids: string[]) => void;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  /** 현재 정렬 기준으로 표에 보이는 모델 id 순서(전체 행). */
  onSortedModelIdsChange?: (ids: string[]) => void;
  /** true이면 체크·행 토글·전체 선택을 막습니다(예: 벤치 실행 중). */
  selectionDisabled?: boolean;
  profileHintByModelId?: Record<string, ProfileHint>;
  /** 벤치 스트림에서 현재 다루는 모델 id(행 테두리 강조). */
  benchActiveModelId?: string | null;
  /** 벤치가 진행 중이면 프로파일 링크 이탈 확인 다이얼로그에 추가 안내가 표시됨. */
  benchRunning?: boolean;
}) {
  const { m: t } = useI18n();
  const data = useMemo<ModelRow[]>(() => models.map((m) => ({ ...m })), [models]);
  const allSelected = models.length > 0 && models.every((m) => selected[m.id]);
  const someSelected = models.some((m) => selected[m.id]);
  const rowPointerRef = useRef<{ x: number; y: number; modelId: string } | null>(null);
  const [pendingHash, setPendingHash] = useState<string | null>(null);
  const navigate = useNavigate();

  // 텍스트 필터 — TanStack `data`는 전체 유지하고 렌더 단계에서만 거른다.
  // (`onSortedModelIdsChange`가 보고하는 id 순서를 줄이면 벤치 큐가 누락되므로 globalFilter는 쓰지 않음.)
  const [filterText, setFilterText] = useState("");
  const q = filterText.trim().toLowerCase();
  const matchesQuery = useCallback(
    (m: ModelRow) => !q || m.id.toLowerCase().includes(q) || (m.label?.toLowerCase().includes(q) ?? false),
    [q],
  );
  // 모델 목록(=새 감지)이 바뀌면 필터를 초기화해 stale 필터가 새 목록을 가리지 않게 함.
  useEffect(() => setFilterText(""), [models]);
  const visibleModels = useMemo(() => models.filter(matchesQuery), [models, matchesQuery]);
  const allVisibleSelected = visibleModels.length > 0 && visibleModels.every((m) => selected[m.id]);
  const noVisible = visibleModels.length === 0;
  const visibleModelIdsRef = useRef<string[]>([]);
  visibleModelIdsRef.current = visibleModels.map((m) => m.id);
  const handleSelectAllVisible = useCallback(() => {
    if (selectionDisabled) return;
    onSelectAll(!allVisibleSelected, visibleModelIdsRef.current);
  }, [allVisibleSelected, onSelectAll, selectionDisabled]);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: () => (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:pointer-events-none disabled:opacity-50"
            aria-label={allVisibleSelected ? msg().bench.deselectShown : msg().bench.selectShown}
            title={allVisibleSelected ? msg().bench.deselectShown : msg().bench.selectShown}
            disabled={selectionDisabled || noVisible}
            onClick={handleSelectAllVisible}
          >
            {allVisibleSelected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
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
            aria-label={msg().bench.selectModelAria(ctx.row.original.id)}
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
        cell: (info) => <ModelLabel modelId={info.getValue()} showQuant size={14} className="text-xs" />,
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
            {msg().bench.colParams}
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
            {msg().bench.colDisk}
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
        header: () => <span className="font-medium text-[var(--muted)]">{msg().bench.profile}</span>,
        cell: ({ row }) => (
          <ProfileHintCell
            hint={profileHintByModelId?.[row.original.id]}
            onRequestLeave={setPendingHash}
          />
        ),
        enableSorting: false,
      }),
    ],
    [allVisibleSelected, noVisible, handleSelectAllVisible, onToggle, profileHintByModelId, selected, selectionDisabled],
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

  // 정렬된 전체 행 중 필터에 맞는 행만 표시(데이터/정렬/보고 id는 전체 유지).
  const visibleRows = table.getRowModel().rows.filter((r) => matchesQuery(r.original));

  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted)]"
          aria-hidden
        />
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder={t.bench.modelFilterPlaceholder}
          aria-label={t.bench.modelFilterAria}
          spellCheck={false}
          className="w-full rounded border border-[var(--border)] bg-[var(--surface-2)] py-1.5 pl-7 pr-7 font-mono text-xs text-[var(--foreground)]"
        />
        {filterText ? (
          <button
            type="button"
            aria-label={t.bench.clearFilter}
            title={t.bench.clearFilter}
            onClick={() => setFilterText("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="max-h-64 overflow-auto rounded border border-[var(--border)]">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t.bench.modelListCaption}</caption>
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
                  {t.bench.noMatchingModels}
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
              <tr
                key={row.id}
                className={[
                  selectionDisabled
                    ? "border-t border-[var(--border)] opacity-80"
                    : "cursor-pointer border-t border-[var(--border)] hover:bg-[var(--surface-2)] focus-visible:bg-[var(--surface-2)]",
                  benchActiveModelId != null && row.original.id === benchActiveModelId ? "bench-model-row--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                tabIndex={selectionDisabled ? -1 : 0}
                aria-disabled={selectionDisabled || undefined}
                aria-label={t.bench.toggleSelectAria(row.original.id)}
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
              ))
            )}
          </tbody>
        </table>
        <p className="border-t border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted)]">
          {modelTableSortLine(sorting, t.bench)}
          {" · "}
          {t.bench.selectedCount(models.filter((m) => selected[m.id]).length, models.length)}
          {q ? t.bench.filterShown(q, visibleModels.length) : null}
          {someSelected && !allSelected ? t.bench.someSelected : null}
          {selectionDisabled ? t.bench.selectionLockedDuringBench : null}
        </p>
        <ConfirmDialog
          open={pendingHash !== null}
          title={t.bench.profileDocNavTitle}
          confirmLabel={t.bench.navigate}
          onConfirm={() => {
            const h = pendingHash;
            setPendingHash(null);
            if (h) navigate({ pathname: "/profile", hash: h });
          }}
          onCancel={() => setPendingHash(null)}
        >
          <p>{t.bench.leaveForProfileDoc}</p>
          {benchRunning ? (
            <p className="mt-2 text-[var(--muted)]">
              {t.bench.benchRunningNavNote}
            </p>
          ) : null}
        </ConfirmDialog>
      </div>
    </div>
  );
}
