/** 카테고리 칩·토글이 공유하는 선택 채움 단계. */
export type FillLevel = "none" | "partial" | "all";

export function fillLevel(selected: number, total: number): FillLevel {
  if (total <= 0 || selected <= 0) return "none";
  if (selected >= total) return "all";
  return "partial";
}

const TOGGLE_BASE = "inline-flex items-center gap-1 rounded border px-2 py-1";

export function categoryToggleClass(level: FillLevel): string {
  if (level === "all") {
    return `${TOGGLE_BASE} border-[var(--accent)] bg-[var(--accent)] text-white shadow-sm`;
  }
  if (level === "partial") {
    return `${TOGGLE_BASE} border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent-2)]`;
  }
  return `${TOGGLE_BASE} border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-2)]`;
}

export function categoryChipClass(level: FillLevel): string {
  if (level === "all") {
    return "rounded px-1.5 py-0.5 bg-[var(--accent)] text-white";
  }
  if (level === "partial") {
    return "rounded px-1.5 py-0.5 bg-[var(--accent)]/15 text-[var(--accent-2)]";
  }
  return "rounded px-1.5 py-0.5 bg-[var(--surface-2)] text-[var(--muted)]";
}

export function fillAriaPressed(level: FillLevel): boolean | "mixed" {
  if (level === "all") return true;
  if (level === "partial") return "mixed";
  return false;
}
