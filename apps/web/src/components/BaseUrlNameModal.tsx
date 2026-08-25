import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { useFocusTrap } from "../useFocusTrap";
import { useScrollLock } from "../useScrollLock";

export type BaseUrlNameModalProps = {
  open: boolean;
  /** 정규화된 base_url(trailing slash 제거). */
  baseUrl: string;
  initialName?: string;
  initialNote?: string;
  busy?: boolean;
  onClose: () => void;
  /** 입력 값(trim 완료)으로 저장 요청. 부모가 토스트·닫기 처리. */
  onSubmit: (name: string, note: string) => void;
};

/** Base URL 별칭(이름 + 기기/스펙 메모) 편집 모달 — ConfirmDialog와 동일한 접근성 패턴. */
export function BaseUrlNameModal({
  open,
  baseUrl,
  initialName = "",
  initialNote = "",
  busy = false,
  onClose,
  onSubmit,
}: BaseUrlNameModalProps) {
  const { m } = useI18n();
  const titleId = useId();
  const nameId = useId();
  const noteId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // 실제로 다이얼로그를 그리는 조건 — 스크롤 락·포커스 트랩·Esc 리스너가 모두 이 값을 따라야 한다.
  // (`open`만 보면 baseUrl이 빈 문자열일 때 아무것도 안 보이는 채로 body 스크롤만 잠긴다.)
  const visible = open && !!baseUrl;

  useScrollLock(visible);
  useFocusTrap(panelRef, visible);

  const [name, setName] = useState(initialName);
  const [note, setNote] = useState(initialNote);

  // 초기값은 '열릴 때 한 번'만 읽는다. 값 자체를 의존성에 넣으면 별칭 목록 fetch가 늦게 도착할 때
  // 입력 중인 내용을 덮어써 버린다.
  const initialRef = useRef({ name: initialName, note: initialNote });
  initialRef.current = { name: initialName, note: initialNote };

  // 대상(base_url)이 바뀌어 열릴 때 입력 초기화.
  useEffect(() => {
    if (!visible) return;
    setName(initialRef.current.name);
    setNote(initialRef.current.note);
    const t = window.setTimeout(() => nameInputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [visible, baseUrl]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, busy, onClose]);

  if (!visible) return null;

  const fieldClass =
    "rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]";

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-label={m.common.close}
        className="absolute inset-0 bg-black/50"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[101] w-full max-w-md rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-lg"
      >
        <h2 id={titleId} className="text-base font-semibold text-[var(--foreground)]">
          {m.baseUrlNames.title}
        </h2>
        <div className="mt-3 grid gap-1">
          <span className="text-xs text-[var(--muted)]">{m.baseUrlNames.urlLabel}</span>
          <p className="break-all rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 font-mono text-xs text-[var(--muted)]" title={baseUrl}>
            {baseUrl}
          </p>
        </div>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) onSubmit(name.trim(), note.trim());
          }}
        >
          <label htmlFor={nameId} className="grid gap-1 text-xs text-[var(--muted)]">
            <span>{m.baseUrlNames.nameLabel}</span>
            <input
              id={nameId}
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={m.baseUrlNames.placeholder}
              maxLength={64}
              disabled={busy}
              className={fieldClass}
            />
          </label>
          <label htmlFor={noteId} className="grid gap-1 text-xs text-[var(--muted)]">
            <span>{m.baseUrlNames.noteLabel}</span>
            <input
              id={noteId}
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={m.baseUrlNames.notePlaceholder}
              maxLength={200}
              disabled={busy}
              className={fieldClass}
            />
          </label>
          <p className="text-[11px] text-[var(--muted)]">{m.baseUrlNames.emptyClearsHint}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!busy) onClose();
              }}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--foreground)] shadow-sm disabled:opacity-50"
            >
              {m.common.cancel}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
            >
              {busy ? m.common.processing : m.baseUrlNames.save}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
