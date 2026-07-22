import { lazy, Suspense, forwardRef, useLayoutEffect, useMemo, useRef } from "react";
import { Sparkles } from "lucide-react";
import { useI18n } from "../i18n";

const LazyHighlight = lazy(async () => {
  const m = await import("./json-highlight-loaded");
  return { default: m.HighlightCode };
});

const FallbackPre = forwardRef<HTMLPreElement, { code: string; maxHeight: number }>(function FallbackPre(
  { code, maxHeight },
  ref,
) {
  const { m } = useI18n();
  return (
    <pre
      ref={ref}
      tabIndex={0}
      aria-label={m.common.codeScrollable}
      className="overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs leading-relaxed text-[var(--muted)]"
      style={{ maxHeight }}
    >
      {code}
    </pre>
  );
});

export function JsonCodeBlock({
  code,
  language = "markdown",
  maxHeight = 256,
  enabled,
  stickToBottom = false,
}: {
  code: string;
  language?: string;
  maxHeight?: number;
  enabled: boolean;
  /** true이면 스크롤 컨테이너를 내용 하단에 맞춤(예: 스트리밍 프리뷰). */
  stickToBottom?: boolean;
}) {
  const trimmed = useMemo(() => code.trim(), [code]);
  const preRef = useRef<HTMLPreElement>(null);

  useLayoutEffect(() => {
    if (!stickToBottom) return;
    if (!trimmed) return;
    const el = preRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [code, stickToBottom, enabled, trimmed]);

  if (!trimmed) {
    return <p className="text-sm text-[var(--muted)]">—</p>;
  }
  if (!enabled) {
    return <FallbackPre ref={preRef} code={code} maxHeight={maxHeight} />;
  }
  return (
    <Suspense fallback={<FallbackPre ref={preRef} code={code} maxHeight={maxHeight} />}>
      <LazyHighlight ref={preRef} code={code} language={language} maxHeight={maxHeight} />
    </Suspense>
  );
}

export function HighlightToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  const { m } = useI18n();
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <Sparkles className="size-3.5 shrink-0 text-[var(--accent)]" aria-hidden />
      {m.common.syntaxHighlightLazy}
    </label>
  );
}
