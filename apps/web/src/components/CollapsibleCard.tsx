import { memo, useId, useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

/**
 * 단계 번호 없는 접이식 카드. StepSection과 같이 본문은 언마운트하지 않고 `hidden`만 쓴다.
 * 헤더 액션(링크·토글)은 접기 버튼 밖에 둔다 — 안에 넣으면 nested-interactive 위반.
 */
export type CollapsibleCardProps = {
  /** 생략하면 내부 useId. `aria-controls` 대상과 섹션 앵커에 쓴다. */
  id?: string;
  title: string;
  icon?: LucideIcon;
  headingLevel?: 2 | 3;
  /** 접혔을 때 제목 옆에 한 줄로 붙는 요약. */
  summary?: ReactNode;
  headerActions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
};

export const CollapsibleCard = memo(function CollapsibleCard({
  id: idProp,
  title,
  icon: Icon,
  headingLevel = 2,
  summary,
  headerActions,
  defaultOpen = true,
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const autoId = useId();
  const id = idProp ?? autoId;
  const bodyId = `${id}-body`;
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <section id={id} className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-sm">
      <div className="flex items-center gap-2 pr-3">
        <Heading className="flex min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((v) => !v)}
            className="flex w-full min-w-0 items-center gap-2 py-3 pl-4 pr-2 text-left"
          >
            {Icon ? <Icon className="size-4 shrink-0 text-[var(--muted)]" aria-hidden /> : null}
            <span className="shrink-0 text-sm font-semibold text-[var(--foreground)]">{title}</span>
            {!open && summary ? (
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">{summary}</span>
            ) : null}
            <ChevronDown
              className={`ml-auto size-4 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
        </Heading>
        {headerActions}
      </div>
      <div id={bodyId} className={open ? "border-t border-[var(--border)] px-4 pb-4 pt-3" : "hidden"}>
        {children}
      </div>
    </section>
  );
});
