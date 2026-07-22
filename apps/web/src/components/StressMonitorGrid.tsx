import { STRESS_MAX_LIVE_CELLS } from "@llm-bench/shared";
import { StressStageProgressBar } from "./StressStageProgressBar";
import { StressWorkerCell, type StressCellStatus } from "./StressWorkerCell";
import { useI18n, type Messages } from "../i18n";

export type StressCellState = {
  status: StressCellStatus;
  userPrompt: string;
  systemPrompt?: string;
  responseText: string;
  reasoningText: string;
  errorMessage?: string;
  /** 이 워커가 *전체 런* 동안 발사한 누적 요청 수 (request_start마다 +1) */
  requestCount: number;
  /** 마지막으로 완료된 요청의 total_ms (request_end에서 덮어씀) */
  lastTotalMs: number | null;
};

export function emptyCellState(): StressCellState {
  return {
    status: "idle",
    userPrompt: "",
    responseText: "",
    reasoningText: "",
    requestCount: 0,
    lastTotalMs: null,
  };
}

export type StressGridRunStatus = "idle" | "running" | "finished" | "aborted" | "error";

function regionLabel(m: Messages, status: StressGridRunStatus): string {
  if (status === "finished" || status === "aborted") return m.stress.grid.regionFinished;
  if (status === "error") return m.stress.grid.regionError;
  return m.stress.grid.region;
}

function headerLine(
  m: Messages,
  status: StressGridRunStatus,
  slots: number,
  concurrency: number,
  lastStageIndex: number | null,
): string {
  if (status === "running" && lastStageIndex == null) {
    return m.stress.grid.preparing(slots);
  }
  if (status === "running") {
    return m.stress.grid.runningStage((lastStageIndex ?? 0) + 1, concurrency, slots);
  }
  const stageLine = lastStageIndex != null ? m.stress.grid.lastStage(lastStageIndex + 1, concurrency) : "";
  if (status === "finished") return `${stageLine} (${m.stress.grid.tagFinished})`.trim();
  if (status === "aborted") return `${stageLine} (${m.stress.grid.tagAborted})`.trim();
  if (status === "error") return stageLine ? `${stageLine} (${m.stress.grid.tagError})` : `(${m.stress.grid.tagError})`;
  return m.stress.grid.liveWorkers;
}

export function StressMonitorGrid({
  concurrency,
  cells,
  runStatus,
  lastStageIndex,
  stageStartedAt,
  stageDurationMs,
}: {
  concurrency: number;
  cells: StressCellState[];
  runStatus: StressGridRunStatus;
  lastStageIndex: number | null;
  /** `running` 중 현재 단계 시작 시각(performance.now). 다른 상태에서는 null. */
  stageStartedAt?: number | null;
  /** 현재 단계의 enqueue duration (ms). */
  stageDurationMs?: number | null;
}) {
  const { m } = useI18n();
  const slots = cells.length;
  const truncated = concurrency > STRESS_MAX_LIVE_CELLS;
  return (
    <section
      aria-label={regionLabel(m, runStatus)}
      className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 shadow-sm"
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-[var(--foreground)]">
          {headerLine(m, runStatus, slots, concurrency, lastStageIndex)}
        </span>
        {truncated ? (
          <span className="rounded bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
            {m.stress.grid.truncated(concurrency, STRESS_MAX_LIVE_CELLS, concurrency - STRESS_MAX_LIVE_CELLS)}
          </span>
        ) : null}
      </div>
      {runStatus === "running" && stageStartedAt != null && stageDurationMs != null ? (
        <StressStageProgressBar stageStartedAt={stageStartedAt} stageDurationMs={stageDurationMs} />
      ) : null}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {Array.from({ length: slots }, (_, i) => {
          const c = cells[i] ?? emptyCellState();
          // A안: running 중에만 디밍, 종료 후엔 전 슬롯 밝게(스냅샷). status는 무관.
          const dimmed = runStatus === "running" && i >= concurrency;
          return (
            <StressWorkerCell
              key={i}
              workerIndex={i}
              status={c.status}
              userPrompt={c.userPrompt}
              systemPrompt={c.systemPrompt}
              responseText={c.responseText}
              reasoningText={c.reasoningText}
              errorMessage={c.errorMessage}
              dimmed={dimmed}
              requestCount={c.requestCount}
              lastTotalMs={c.lastTotalMs}
            />
          );
        })}
      </div>
    </section>
  );
}
