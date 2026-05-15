import { STRESS_MAX_LIVE_CELLS } from "@llm-bench/shared";
import { StressWorkerCell, type StressCellStatus } from "./StressWorkerCell";

export type StressCellState = {
  status: StressCellStatus;
  userPrompt: string;
  systemPrompt?: string;
  responseText: string;
  reasoningText: string;
  errorMessage?: string;
};

export function emptyCellState(): StressCellState {
  return {
    status: "idle",
    userPrompt: "",
    responseText: "",
    reasoningText: "",
  };
}

export function StressMonitorGrid({
  concurrency,
  cells,
}: {
  concurrency: number;
  cells: StressCellState[];
}) {
  const liveCount = Math.min(concurrency, STRESS_MAX_LIVE_CELLS);
  const truncated = concurrency > STRESS_MAX_LIVE_CELLS;
  return (
    <section
      role="region"
      aria-label="동시 사용자 모니터"
      className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 shadow-sm"
    >
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-[var(--foreground)]">동시 워커 라이브</span>
        {truncated ? (
          <span className="rounded bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
            동시 사용자 {concurrency}명 중 16명만 라이브로 보여집니다 — 나머지 {concurrency - STRESS_MAX_LIVE_CELLS}명은 집계 차트·표에 그대로 반영
          </span>
        ) : null}
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {Array.from({ length: liveCount }, (_, i) => {
          const c = cells[i] ?? emptyCellState();
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
            />
          );
        })}
      </div>
    </section>
  );
}
