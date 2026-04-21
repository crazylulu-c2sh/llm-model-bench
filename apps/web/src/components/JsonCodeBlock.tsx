import { lazy, Suspense, useMemo } from "react";
import { Sparkles } from "lucide-react";

const LazyHighlight = lazy(async () => {
  const m = await import("./json-highlight-loaded");
  return { default: m.HighlightCode };
});

function FallbackPre({ code, maxHeight }: { code: string; maxHeight: number }) {
  return (
    <pre
      className="overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs leading-relaxed text-[var(--muted)]"
      style={{ maxHeight }}
    >
      {code}
    </pre>
  );
}

export function JsonCodeBlock({
  code,
  language = "markdown",
  maxHeight = 256,
  enabled,
}: {
  code: string;
  language?: string;
  maxHeight?: number;
  enabled: boolean;
}) {
  const trimmed = useMemo(() => code.trim(), [code]);
  if (!trimmed) {
    return <p className="text-sm text-[var(--muted)]">—</p>;
  }
  if (!enabled) {
    return <FallbackPre code={code} maxHeight={maxHeight} />;
  }
  return (
    <Suspense fallback={<FallbackPre code={code} maxHeight={maxHeight} />}>
      <LazyHighlight code={code} language={language} maxHeight={maxHeight} />
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
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <Sparkles className="size-3.5 shrink-0 text-[var(--accent)]" aria-hidden />
      구문 강조 (lazy)
    </label>
  );
}
