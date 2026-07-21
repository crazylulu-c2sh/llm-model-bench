import { expectedScriptForWorkload, type StressRunDetailResponse, type StressRunsListResponse } from "@llm-bench/shared";
import { Download, Loader2, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { StressResultTable } from "./components/StressResultTable";
import { StressTpsChart } from "./components/StressTpsChart";
import {
  CSV_BOM as _CSV_BOM,
  downloadTextFile,
  stressRunToCsv,
  stressRunToJson,
} from "./lib/stress-export";
import { workloadLabel } from "./lib/stress-labels";
import { formatIsoLocal } from "./lib/time-format";

// suppress unused warning in some build configs
void _CSV_BOM;

type AppliedFilters = {
  workload_id: string;
  status: string;
  model_id: string;
  base_url: string;
};

const EMPTY_FILTERS: AppliedFilters = { workload_id: "", status: "", model_id: "", base_url: "" };

const EMPTY_OPTIONS = {
  workload_ids: [] as string[],
  statuses: [] as Array<"running" | "ok" | "partial" | "error">,
  model_ids: [] as string[],
  base_urls: [] as string[],
};

function statusBadgeClass(s: string): string {
  switch (s) {
    case "ok":
      return "bg-[var(--accent)]/20 text-[var(--accent-2)]";
    case "partial":
      return "bg-[var(--tier-good)]/20 text-[var(--tier-good)]";
    case "error":
      return "bg-[var(--danger)]/15 text-[var(--danger)]";
    case "running":
      return "bg-[var(--muted)]/15 text-[var(--muted)] animate-pulse";
    default:
      return "bg-[var(--muted)]/10 text-[var(--muted)]";
  }
}

function buildQuery(filters: AppliedFilters, cursor?: { before: string; before_id: string }, limit = 50): string {
  const sp = new URLSearchParams();
  if (filters.workload_id) sp.set("workload_id", filters.workload_id);
  if (filters.status) sp.set("status", filters.status);
  if (filters.model_id) sp.set("model_id", filters.model_id);
  if (filters.base_url) sp.set("base_url", filters.base_url);
  if (cursor) {
    sp.set("before", cursor.before);
    sp.set("before_id", cursor.before_id);
  }
  sp.set("limit", String(limit));
  return sp.toString();
}

export function StressStatsPage() {
  const [draftFilters, setDraftFilters] = useState<AppliedFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>(EMPTY_FILTERS);
  const [items, setItems] = useState<StressRunsListResponse["items"]>([]);
  const [filterOptions, setFilterOptions] = useState<StressRunsListResponse["filter_options"]>(EMPTY_OPTIONS);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StressRunDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const listAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);

  const fetchList = useCallback(
    async (filters: AppliedFilters, cursor?: { before: string; before_id: string }) => {
      listAbortRef.current?.abort();
      const ac = new AbortController();
      listAbortRef.current = ac;
      const isLoadMore = !!cursor;
      if (isLoadMore) setLoadMoreLoading(true);
      else setListLoading(true);
      try {
        const res = await fetch(`/api/stress/runs?${buildQuery(filters, cursor)}`, { signal: ac.signal });
        const j = (await res.json()) as StressRunsListResponse;
        if (ac.signal.aborted) return;
        if (j.sqlite_available === false) {
          toast.warning(j.sqlite_error ?? "SQLite를 사용할 수 없습니다.");
        }
        if (isLoadMore) {
          setItems((prev) => [...prev, ...(j.items ?? [])]);
        } else {
          setItems(j.items ?? []);
          setSelectedRunId(null);
          setDetail(null);
        }
        setFilterOptions(j.filter_options ?? EMPTY_OPTIONS);
        setHasMore(!!j.has_more);
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        toast.error(String(e));
      } finally {
        if (isLoadMore) setLoadMoreLoading(false);
        else setListLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchList(appliedFilters);
    return () => {
      listAbortRef.current?.abort();
    };
  }, [appliedFilters, fetchList]);

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null);
      return;
    }
    detailAbortRef.current?.abort();
    const ac = new AbortController();
    detailAbortRef.current = ac;
    setDetailLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/stress/runs/${encodeURIComponent(selectedRunId)}`, { signal: ac.signal });
        if (ac.signal.aborted) return;
        if (res.status === 404) {
          toast.warning("런이 더 이상 존재하지 않습니다.");
          setItems((prev) => prev.filter((x) => x.run_id !== selectedRunId));
          setSelectedRunId(null);
          setDetail(null);
          return;
        }
        if (!res.ok) {
          toast.error(`상세 로드 실패 (${res.status})`);
          return;
        }
        const j = (await res.json()) as StressRunDetailResponse;
        if (ac.signal.aborted) return;
        setDetail(j);
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        toast.error(String(e));
      } finally {
        setDetailLoading(false);
      }
    })();
    return () => {
      ac.abort();
    };
  }, [selectedRunId]);

  const onApply = () => setAppliedFilters(draftFilters);
  const onReset = () => {
    setDraftFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  };
  const onLoadMore = () => {
    const last = items[items.length - 1];
    if (!last) return;
    fetchList(appliedFilters, { before: last.created_at, before_id: last.run_id });
  };

  const onDelete = async () => {
    if (!confirmId) return;
    setDeletePending(true);
    try {
      const res = await fetch(`/api/stress/runs/${encodeURIComponent(confirmId)}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(`삭제 실패 (${res.status})`);
        return;
      }
      setItems((prev) => prev.filter((x) => x.run_id !== confirmId));
      if (selectedRunId === confirmId) {
        setSelectedRunId(null);
        setDetail(null);
      }
      toast.success("삭제됨");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeletePending(false);
      setConfirmId(null);
    }
  };

  const confirmRow = useMemo(
    () => (confirmId ? items.find((x) => x.run_id === confirmId) ?? null : null),
    [confirmId, items],
  );

  const expectedScript = useMemo(() => {
    if (!detail) return "latin" as const;
    return expectedScriptForWorkload(detail.meta.workload_id);
  }, [detail]);

  const rampSummary = useMemo(() => {
    if (!detail) return "";
    const r = detail.meta.ramp;
    if (!r) return "";
    return `${r.start}→${r.max} step ${r.step} · ${r.durationMs}ms/stage`;
  }, [detail]);

  return (
    <>
      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">필터</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-xs text-[var(--muted)]">
            <span>워크로드</span>
            <select
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              value={draftFilters.workload_id}
              onChange={(e) => setDraftFilters((p) => ({ ...p, workload_id: e.target.value }))}
            >
              <option value="">전체</option>
              {filterOptions.workload_ids.map((id) => (
                <option key={id} value={id}>
                  {workloadLabel(id)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[var(--muted)]">
            <span>상태</span>
            <select
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              value={draftFilters.status}
              onChange={(e) => setDraftFilters((p) => ({ ...p, status: e.target.value }))}
            >
              <option value="">전체</option>
              {filterOptions.statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[var(--muted)]">
            <span>모델</span>
            <select
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm font-mono"
              value={draftFilters.model_id}
              onChange={(e) => setDraftFilters((p) => ({ ...p, model_id: e.target.value }))}
            >
              <option value="">전체</option>
              {filterOptions.model_ids.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[var(--muted)]">
            <span>Base URL</span>
            <select
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm font-mono"
              value={draftFilters.base_url}
              onChange={(e) => setDraftFilters((p) => ({ ...p, base_url: e.target.value }))}
            >
              <option value="">전체</option>
              {filterOptions.base_urls.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-[var(--border)] bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white shadow-sm disabled:opacity-50"
            onClick={onApply}
            disabled={listLoading}
          >
            {listLoading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" aria-hidden /> 적용 중…
              </span>
            ) : (
              "적용"
            )}
          </button>
          <button
            type="button"
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium shadow-sm"
            onClick={onReset}
            disabled={listLoading}
          >
            초기화
          </button>
        </div>
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">프로바이더 런 ({items.length}건{hasMore ? "+" : ""})</h2>
        {listLoading && items.length === 0 ? (
          <div role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 className="size-4 animate-spin" aria-hidden /> 불러오는 중…
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">표시할 런이 없습니다. /stress에서 먼저 실행하세요.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-[var(--border)] text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-1">모델</th>
                  <th className="px-2 py-1">프로바이더</th>
                  <th className="px-2 py-1">워크로드</th>
                  <th className="px-2 py-1">Base URL</th>
                  <th className="px-2 py-1">상태</th>
                  <th className="px-2 py-1">시작</th>
                  <th className="px-2 py-1">종료</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const selected = it.run_id === selectedRunId;
                  return (
                    <tr
                      key={it.run_id}
                      role="row"
                      aria-selected={selected}
                      tabIndex={0}
                      onClick={() => setSelectedRunId(it.run_id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedRunId(it.run_id);
                        }
                      }}
                      className={`cursor-pointer border-b border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface)] ${
                        selected ? "bg-[var(--accent)]/10" : ""
                      }`}
                    >
                      <td className="px-2 py-1 font-mono">
                        <span className="block max-w-[18ch] truncate" title={it.model_id}>
                          {it.model_id}
                        </span>
                      </td>
                      <td className="px-2 py-1 font-mono">{it.provider}</td>
                      <td className="px-2 py-1">{workloadLabel(it.workload_id)}</td>
                      <td className="px-2 py-1 font-mono">
                        <span className="block max-w-[24ch] truncate" title={it.base_url}>
                          {it.base_url}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${statusBadgeClass(it.status)}`}>
                          {it.status}
                        </span>
                      </td>
                      <td className="px-2 py-1 font-mono">{formatIsoLocal(it.created_at)}</td>
                      <td className="px-2 py-1 font-mono">{formatIsoLocal(it.finished_at)}</td>
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          className="rounded p-1.5 text-[var(--muted)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
                          aria-label="런 삭제"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmId(it.run_id);
                          }}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {hasMore ? (
          <div className="mt-3">
            <button
              type="button"
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium shadow-sm disabled:opacity-50"
              onClick={onLoadMore}
              disabled={loadMoreLoading}
            >
              {loadMoreLoading ? (
                <span role="status" className="inline-flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" aria-hidden /> 더 불러오는 중…
                </span>
              ) : (
                "더 보기"
              )}
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-[var(--foreground)]">상세</h2>
        {!selectedRunId ? (
          <p className="py-6 text-center text-sm text-[var(--muted)]">위 리스트에서 런을 선택하세요.</p>
        ) : detailLoading || !detail ? (
          <div role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 className="size-4 animate-spin" aria-hidden /> 불러오는 중…
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-2 rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-xs sm:grid-cols-2">
              <div><span className="text-[var(--muted)]">run_id</span> <span className="font-mono">{detail.meta.run_id}</span></div>
              <div><span className="text-[var(--muted)]">model</span> <span className="font-mono">{detail.meta.model_id}</span></div>
              <div><span className="text-[var(--muted)]">provider</span> <span className="font-mono">{detail.meta.provider}</span></div>
              <div><span className="text-[var(--muted)]">workload</span> {workloadLabel(detail.meta.workload_id)}</div>
              <div><span className="text-[var(--muted)]">base_url</span> <span className="font-mono">{detail.meta.base_url}</span></div>
              <div><span className="text-[var(--muted)]">상태</span> <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${statusBadgeClass(detail.meta.status)}`}>{detail.meta.status}</span></div>
              <div><span className="text-[var(--muted)]">시작</span> <span className="font-mono">{formatIsoLocal(detail.meta.created_at)}</span></div>
              <div><span className="text-[var(--muted)]">종료</span> <span className="font-mono">{formatIsoLocal(detail.meta.finished_at)}</span></div>
              {rampSummary ? (
                <div className="sm:col-span-2"><span className="text-[var(--muted)]">ramp</span> <span className="font-mono">{rampSummary}</span></div>
              ) : null}
              {detail.meta.error_code || detail.meta.error_message ? (
                <div className="sm:col-span-2 text-[var(--danger)]">
                  <span className="font-mono">{detail.meta.error_code ?? "error"}</span>: {detail.meta.error_message ?? ""}
                </div>
              ) : null}
            </div>
            {detail.meta.status === "running" ? (
              <p className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
                이 런은 진행 중입니다 — <Link to="/stress" className="text-[var(--accent-2)] underline">라이브 모니터링 보기</Link>. 현재까지 완료된 단계만 표시됩니다.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium shadow-sm"
                onClick={() =>
                  downloadTextFile(
                    `stress-${detail.meta.run_id}.json`,
                    "application/json;charset=utf-8",
                    stressRunToJson(detail),
                  )
                }
              >
                <Download className="size-3.5" aria-hidden /> JSON
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium shadow-sm"
                onClick={() =>
                  downloadTextFile(
                    `stress-${detail.meta.run_id}.csv`,
                    "text/csv;charset=utf-8",
                    stressRunToCsv(detail),
                  )
                }
              >
                <Download className="size-3.5" aria-hidden /> CSV
              </button>
            </div>
            <StressTpsChart stages={detail.stages} />
            <StressResultTable stages={detail.stages} expectedScript={expectedScript} />
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmId != null}
        title="프로바이더 런 삭제"
        variant="danger"
        confirmLabel="삭제"
        pending={deletePending}
        onCancel={() => setConfirmId(null)}
        onConfirm={onDelete}
      >
        <p>이 런과 모든 단계 결과가 영구 삭제됩니다 (되돌릴 수 없음).</p>
        {confirmRow?.status === "running" ? (
          <p className="mt-2 text-[var(--danger)]">
            ⚠ 라이브 실행 중인 런입니다 — /stress에서 동시에 실행 중이면 데이터 손상 위험.
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
