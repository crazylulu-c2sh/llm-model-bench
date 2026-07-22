import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { useScrollLock } from "../useScrollLock";
import { useFocusTrap } from "../useFocusTrap";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  variant = "default",
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { m } = useI18n();
  const titleId = useId();
  const descId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useScrollLock(open);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => confirmRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, pending, onCancel]);

  if (!open) return null;

  const confirmClass =
    variant === "danger"
      ? "rounded-md bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
      : "rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50";

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-label={m.common.close}
        className="absolute inset-0 bg-black/50"
        onClick={() => {
          if (!pending) onCancel();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative z-[101] w-full max-w-md rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-lg"
      >
        <h2 id={titleId} className="text-base font-semibold text-[var(--foreground)]">
          {title}
        </h2>
        <div id={descId} className="mt-3 text-sm text-[var(--muted)]">
          {children}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--foreground)] shadow-sm disabled:opacity-50"
            onClick={onCancel}
            disabled={pending}
          >
            {cancelLabel ?? m.common.cancel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={confirmClass}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? m.common.processing : (confirmLabel ?? m.common.confirm)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
