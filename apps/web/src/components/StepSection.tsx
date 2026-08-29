import { memo, type ReactNode } from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { useI18n } from "../i18n";
import type { StepNumber, StepStatus } from "../lib/bench-steps";

/**
 * 모델 벤치 "/" 페이지의 접이식 단계 하나.
 *
 * - 본문은 **항상 마운트**하고 `hidden`으로만 접는다. 언마운트하면 ModelTable 검색어·정렬 상태와
 *   로그 스크롤이 접을 때마다 초기화되고, `aria-controls` 대상이 DOM에서 사라지며, 접힌 단계 안의
 *   문서 링크를 검사하는 e2e가 깨진다.
 * - `headerStrip`은 토글 버튼 **밖**의 형제 행이다. 5단계가 실행 제어 버튼과 큐 칩을 여기 두어
 *   단계가 접혀 있어도 벤치를 멈출 수 있게 한다.
 * - `headerActions`(문서 링크)도 버튼 밖에 둔다 — 안에 넣으면 nested-interactive 위반.
 */
export type StepSectionProps = {
  /** `bench-step-4` 같은 앵커 id. 자동 스크롤 대상이자 `aria-controls`의 기준. */
  id: string;
  step: StepNumber;
  title: string;
  status: StepStatus;
  icon?: LucideIcon;
  open: boolean;
  onToggle: () => void;
  /** 접혔을 때 제목 옆에 한 줄로 붙는 요약. */
  summary?: ReactNode;
  /** 접힘과 무관하게 항상 보이는 행(실행 제어·큐 칩). */
  headerStrip?: ReactNode;
  /** 헤더 우측 링크 등. 토글 버튼 밖에 렌더된다. */
  headerActions?: ReactNode;
  /** 실행 중 라이브 강조. 앱 전역에서 한 겹만 쓴다. */
  live?: boolean;
  children: ReactNode;
};

const BADGE_CLASS: Record<StepStatus, string> = {
  // 현재 단계가 가장 강하다. 완료 배지를 채우면 이미 지나온 단계가 현재 단계보다 눈에 띄는 위계 역전이 생긴다.
  active: "border-[var(--accent)] bg-[var(--accent)] text-white",
  done: "border-[var(--accent-2)] bg-[var(--accent)]/15 text-[var(--accent-2)]",
  pending: "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]",
};

export const StepSection = memo(function StepSection({
  id,
  step,
  title,
  status,
  icon: Icon,
  open,
  onToggle,
  summary,
  headerStrip,
  headerActions,
  live,
  children,
}: StepSectionProps) {
  const { m } = useI18n();
  const w = m.bench.wizard;
  const bodyId = `${id}-body`;

  return (
    <section
      id={id}
      className={[
        "scroll-mt-36 rounded-md border border-[var(--border)] bg-[var(--surface-2)] sm:scroll-mt-28",
        // 알파 테두리는 UI 대비 3:1을 넘기지 못해서 현재 단계는 실색 좌측 레일로 표시한다.
        status === "active"
          ? "shadow-[inset_3px_0_0_0_var(--accent),0_1px_0_rgba(1,4,9,0.3)]"
          : "shadow-sm",
        live ? "bench-live-panel--soft" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-2 pr-3">
        <h2 className="flex min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={onToggle}
            className="flex w-full min-w-0 items-center gap-3 py-3.5 pl-4 pr-2 text-left"
          >
            <span
              className={`inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border text-[11px] font-bold tabular-nums ${BADGE_CLASS[status]}`}
            >
              <span className="sr-only">{w.stepNumberAria(step)}</span>
              {status === "done" ? (
                <>
                  <Check className="size-3.5" aria-hidden />
                  <span className="sr-only">{w.stepDoneAria}</span>
                </>
              ) : (
                <span aria-hidden>{step}</span>
              )}
            </span>
            {Icon ? <Icon className="size-4 shrink-0 text-[var(--muted)]" aria-hidden /> : null}
            <span
              className={`shrink-0 text-sm font-semibold ${
                status === "pending" ? "text-[var(--muted)]" : "text-[var(--foreground)]"
              }`}
            >
              {title}
            </span>
            {!open && summary ? (
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">{summary}</span>
            ) : null}
            <ChevronDown
              className={`ml-auto size-4 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
        </h2>
        {headerActions}
      </div>

      {headerStrip ? <div className="px-4 pb-3">{headerStrip}</div> : null}

      <div
        id={bodyId}
        className={
          open ? "flex flex-col gap-6 border-t border-[var(--border)] px-4 pb-4 pt-3" : "hidden"
        }
      >
        {children}
      </div>
    </section>
  );
});
