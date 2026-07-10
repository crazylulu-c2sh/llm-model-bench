import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

/** 클립보드에 쓰기. 비보안 컨텍스트(http://LAN-IP 등 clipboard API 미제공)에서는 execCommand로 폴백. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 폴백 경로로 진행
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  text,
  label = "복사",
  copiedLabel = "복사됨",
  title,
  disabled,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  title?: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const onCopy = useCallback(async () => {
    const ok = await writeClipboard(text);
    if (!ok) return;
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [text]);

  const isDisabled = disabled || text.length === 0;

  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={isDisabled}
      title={title ?? label}
      aria-label={copied ? copiedLabel : (title ?? label)}
      className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {copied ? (
        <Check className="size-3 text-green-500" aria-hidden />
      ) : (
        <Copy className="size-3" aria-hidden />
      )}
      {copied ? copiedLabel : label}
    </button>
  );
}
