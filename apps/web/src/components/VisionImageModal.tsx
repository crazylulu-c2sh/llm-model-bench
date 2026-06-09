import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useScrollLock } from "../useScrollLock";

export type VisionImageModalProps = {
  open: boolean;
  imageUrl: string;
  /** 시나리오 ID — 모달 제목에 노출 */
  scenarioId: string;
  /** OCR / 카운트 / 차트 / 밈 / 와이어프레임 등 짧은 한글 카테고리 라벨 */
  categoryLabel?: string;
  onClose: () => void;
};

/**
 * 비전 시나리오 이미지를 풀스크린 가까운 크기로 확대해 보여주는 모달.
 * `ConfirmDialog`와 같은 a11y 수준 (Esc·backdrop click·focus to close button).
 */
export function VisionImageModal({
  open,
  imageUrl,
  scenarioId,
  categoryLabel,
  onClose,
}: VisionImageModalProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;

  const altText = categoryLabel ? `${categoryLabel} · ${scenarioId}` : scenarioId;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* 백드롭은 실제 button — iOS 터치에서 탭→클릭이 확실히 합성된다. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="닫기"
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[101] flex max-h-[92svh] max-w-[92vw] flex-col rounded-md border border-[var(--border)] bg-[var(--surface-2)] shadow-lg"
      >
        <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
          <h2 id={titleId} className="flex items-baseline gap-2 text-sm font-semibold text-[var(--foreground)]">
            {categoryLabel ? (
              <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--accent)]">
                {categoryLabel}
              </span>
            ) : null}
            <span className="font-mono text-xs text-[var(--muted)]">{scenarioId}</span>
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--foreground)] shadow-sm"
            onClick={onClose}
            aria-label="이미지 모달 닫기"
          >
            <X className="size-3.5" aria-hidden />
            닫기
          </button>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto overscroll-contain p-2">
          <img
            src={imageUrl}
            alt={altText}
            className="max-h-[80svh] max-w-[88vw] object-contain"
          />
        </div>
        <footer className="border-t border-[var(--border)] px-3 py-1.5 text-[10px] text-[var(--muted)]">
          {imageUrl} · Esc / 배경 클릭으로 닫기
        </footer>
      </div>
    </div>,
    document.body,
  );
}
