import { STRESS_MAX_LIVE_CELLS } from "@llm-bench/shared";
import { StressStageProgressBar } from "./StressStageProgressBar";
import { StressWorkerCell, type StressCellStatus } from "./StressWorkerCell";

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

function regionLabel(status: StressGridRunStatus): string {
  if (status === "finished" || status === "aborted") return "동시 사용자 모니터 (종료 스냅샷)";
  if (status === "error") return "동시 사용자 모니터 (오류 스냅샷)";
  return "동시 사용자 모니터";
}

function headerLine(
  status: StressGridRunStatus,
  slots: number,
  concurrency: number,
  lastStageIndex: number | null,
): string {
  if (status === "running" && lastStageIndex == null) {
    return `${slots}명 사전 확보 · 준비 중…`;
  }
  if (status === "running") {
    return `단계 ${(lastStageIndex ?? 0) + 1} · 동시 ${concurrency}/${slots}명 활성`;
  }
  const stageLine = lastStageIndex != null ? `마지막 단계 ${lastStageIndex + 1} · 동시 ${concurrency}명` : "";
  if (status === "finished") return `${stageLine} (종료)`.trim();
  if (status === "aborted") return `${stageLine} (중단)`.trim();
  if (status === "error") return stageLine ? `${stageLine} (오류)` : "(오류)";
  return "동시 워커 라이브";
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
  const slots = cells.length;
  const truncated = concurrency > STRESS_MAX_LIVE_CELLS;
  return (
    <section
      role="region"
      aria-label={regionLabel(runStatus)}
      className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 shadow-sm"
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-[var(--foreground)]">
          {headerLine(runStatus, slots, concurrency, lastStageIndex)}
        </span>
        {truncated ? (
          <span className="rounded bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
            동시 사용자 {concurrency}명 중 16명만 라이브로 보여집니다 — 나머지 {concurrency - STRESS_MAX_LIVE_CELLS}명은 집계 차트·표에 그대로 반영
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
