import { memo } from "react";
import { Ban, CheckCircle2, Circle, Loader2, Pause, TriangleAlert, XCircle } from "lucide-react";
import { cleanModelDisplayName } from "@llm-bench/shared";
import { useI18n, type Messages } from "../i18n";
import { collapseQueue, type QueueItem, type QueueModelStatus } from "../lib/bench-steps";

/**
 * 실행 큐의 모델별 상태 칩. 5단계 헤더의 disclosure 버튼 **밖**에 놓여서, 단계가 접혀 있어도
 * 다른 단계를 열어놔도 계속 보인다 — 여러 모델을 돌릴 때 지금 어느 모델인지 확인하는 유일한 표시.
 *
 * 색만으로 상태를 전달하지 않도록 상태마다 다른 형태의 아이콘을 쓰고, 각 칩에 sr-only 상태 텍스트를 붙인다.
 */

// danger·warning 계열은 15% 틴트 위에서 4.5:1을 못 넘긴다(index-css-contrast.test.ts) —
// 틴트 대신 --surface 바탕에 실색 테두리로 구분한다.
const CHIP_CLASS: Record<QueueModelStatus, string> = {
  pending: "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]",
  running: "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent-2)]",
  paused: "border-[var(--warning)] bg-[var(--surface)] text-[var(--warning)]",
  done: "border-[var(--accent-2)] bg-[var(--accent-2)]/15 text-[var(--accent-2)]",
  "done-with-errors": "border-[var(--warning)] bg-[var(--surface)] text-[var(--warning)]",
  failed: "border-[var(--danger)] bg-[var(--surface)] text-[var(--danger)]",
  cancelled: "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]",
};

function StatusIcon({ status }: { status: QueueModelStatus }) {
  const cls = "size-3 shrink-0";
  switch (status) {
    case "running":
      return <Loader2 className={`${cls} motion-safe:animate-spin`} aria-hidden />;
    case "paused":
      return <Pause className={cls} aria-hidden />;
    case "done":
      return <CheckCircle2 className={cls} aria-hidden />;
    case "done-with-errors":
      return <TriangleAlert className={cls} aria-hidden />;
    case "failed":
      return <XCircle className={cls} aria-hidden />;
    case "cancelled":
      return <Ban className={cls} aria-hidden />;
    default:
      return <Circle className={cls} aria-hidden />;
  }
}

function statusLabel(status: QueueModelStatus, w: Messages["bench"]["wizard"]): string {
  if (status === "done-with-errors") return w.queueStatus.doneWithErrors;
  return w.queueStatus[status];
}

export const QueueStatusChips = memo(function QueueStatusChips({
  items,
  max,
}: {
  items: QueueItem[];
  /** 테스트·좁은 폭에서 조절용. 기본값은 QUEUE_CHIP_VISIBLE_MAX. */
  max?: number;
}) {
  const { m } = useI18n();
  const w = m.bench.wizard;
  if (items.length === 0) return null;

  const { items: shown, hiddenCount } = collapseQueue(items, max);

  return (
    <ul className="flex list-none flex-wrap items-center gap-1.5" aria-label={w.queueListAria}>
      {shown.map((item) => {
        const label = statusLabel(item.status, w);
        return (
          <li key={item.id}>
            <span
              className={`inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border py-0.5 pl-1.5 pr-2.5 font-mono text-[11px] sm:max-w-[9rem] md:max-w-[14rem] ${CHIP_CLASS[item.status]}`}
              title={`${item.id} · ${label}`}
              {...(item.status === "running" ? { "aria-current": "step" as const } : {})}
            >
              <StatusIcon status={item.status} />
              <span className="truncate">{cleanModelDisplayName(item.id)}</span>
              <span className="sr-only">{label}</span>
            </span>
          </li>
        );
      })}
      {hiddenCount > 0 ? (
        <li>
          <span
            className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted)]"
            aria-label={w.queueMoreAria(hiddenCount)}
          >
            {w.queueMore(hiddenCount)}
          </span>
        </li>
      ) : null}
    </ul>
  );
});
