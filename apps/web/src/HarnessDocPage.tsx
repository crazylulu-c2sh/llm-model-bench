import { Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import harnessMd from "../../../docs/harness-knowhow.md?raw";
import { HighlightToggle, JsonCodeBlock } from "./components/JsonCodeBlock";

/** 정본(canonical) 마크다운은 저장소의 docs/harness-knowhow.md — GitHub에서도 그대로 읽힙니다. */
const GITHUB_BLOB = "https://github.com/crazylulu-c2sh/llm-model-bench/blob/main";
const CANONICAL_MD = `${GITHUB_BLOB}/docs/harness-knowhow.md`;

type HrefKind =
  | { kind: "anchor"; url: string }
  | { kind: "internal"; url: string }
  | { kind: "external"; url: string };

/**
 * md 원본은 저장소-상대 경로(docs/…, apps/…)로 작성 → GitHub에서 정상 렌더.
 * 웹에서는 그런 상대 경로가 SPA 라우트로 404이므로 GitHub blob URL로 재작성한다.
 * - `#…` : 문서 내 heading 앵커(그대로)
 * - `/…` : 인앱 SPA 라우트(예: /profile#lmstudio-host) — react-router Link로
 * - `http(s)://…` 또는 저장소-상대 : 외부 링크(새 창)
 */
function resolveHref(href: string | undefined): HrefKind {
  if (!href) return { kind: "anchor", url: "#" };
  if (href.startsWith("#")) return { kind: "anchor", url: href };
  if (/^https?:\/\//.test(href)) return { kind: "external", url: href };
  if (href.startsWith("/")) return { kind: "internal", url: href };
  return { kind: "external", url: `${GITHUB_BLOB}/${href.replace(/^\.\//, "")}` };
}

function makeComponents(hlPreview: boolean): Components {
  return {
    h1: ({ node: _n, children, ...props }) => (
      <h1 className="mb-3 text-xl font-semibold tracking-tight text-[var(--foreground)]" {...props}>
        {children}
      </h1>
    ),
    h2: ({ node: _n, children, ...props }) => (
      <h2
        className="mt-8 mb-3 scroll-mt-24 border-b border-[var(--border)] pb-2 text-lg font-semibold text-[var(--foreground)]"
        {...props}
      >
        {children}
      </h2>
    ),
    h3: ({ node: _n, children, ...props }) => (
      <h3 className="mt-6 mb-2 scroll-mt-24 text-base font-semibold text-[var(--foreground)]" {...props}>
        {children}
      </h3>
    ),
    h4: ({ node: _n, children, ...props }) => (
      <h4 className="mt-4 mb-1 scroll-mt-24 text-sm font-semibold text-[var(--foreground)]" {...props}>
        {children}
      </h4>
    ),
    p: ({ node: _n, children, ...props }) => (
      <p className="mb-3 text-sm leading-relaxed text-[var(--muted)]" {...props}>
        {children}
      </p>
    ),
    ul: ({ node: _n, children, ...props }) => (
      <ul className="mb-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-[var(--muted)]" {...props}>
        {children}
      </ul>
    ),
    ol: ({ node: _n, children, ...props }) => (
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-[var(--muted)]" {...props}>
        {children}
      </ol>
    ),
    li: ({ node: _n, children, ...props }) => (
      <li className="leading-relaxed" {...props}>
        {children}
      </li>
    ),
    strong: ({ node: _n, children, ...props }) => (
      <strong className="font-semibold text-[var(--foreground)]" {...props}>
        {children}
      </strong>
    ),
    blockquote: ({ node: _n, children, ...props }) => (
      <blockquote className="mb-3 border-l-2 border-[var(--border)] pl-3 text-sm italic text-[var(--muted)]" {...props}>
        {children}
      </blockquote>
    ),
    hr: ({ node: _n, ...props }) => <hr className="my-6 border-[var(--border)]" {...props} />,
    a: ({ node: _n, href, children, ...props }) => {
      const target = resolveHref(href);
      if (target.kind === "internal") {
        return (
          <Link to={target.url} className="text-[var(--accent-2)] underline" {...props}>
            {children}
          </Link>
        );
      }
      if (target.kind === "external") {
        return (
          <a
            href={target.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-2)] underline"
            {...props}
          >
            {children}
            <span className="sr-only"> (새 창에서 열림)</span>
          </a>
        );
      }
      return (
        <a href={target.url} className="text-[var(--accent-2)] underline" {...props}>
          {children}
        </a>
      );
    },
    table: ({ node: _n, children, ...props }) => (
      <div className="my-3 overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full border-collapse text-left text-xs" {...props}>
          {children}
        </table>
      </div>
    ),
    thead: ({ node: _n, children, ...props }) => (
      <thead className="bg-[var(--surface-2)]" {...props}>
        {children}
      </thead>
    ),
    th: ({ node: _n, children, ...props }) => (
      <th className="border-b border-[var(--border)] p-2 font-medium text-[var(--foreground)]" {...props}>
        {children}
      </th>
    ),
    td: ({ node: _n, children, ...props }) => (
      <td className="border-b border-[var(--border)] p-2 align-top text-[var(--muted)]" {...props}>
        {children}
      </td>
    ),
    // react-markdown은 펜스를 <pre><code>로 감싸므로, 블록 래핑은 아래 code의 JsonCodeBlock(내부 <pre>)에 맡기고
    // pre는 그대로 통과시켜 <pre> 중첩을 피한다.
    pre: ({ children }) => <>{children}</>,
    code: ({ node: _n, className, children, ...props }) => {
      const language = /language-(\w+)/.exec(className ?? "")?.[1];
      if (language) {
        return <JsonCodeBlock code={String(children)} language={language} enabled={hlPreview} maxHeight={480} />;
      }
      return (
        <code
          className="rounded bg-[var(--surface)] px-1 font-mono text-xs text-[var(--foreground)]"
          {...props}
        >
          {children}
        </code>
      );
    },
  };
}

export default function HarnessDocPage() {
  const location = useLocation();
  const [hlPreview, setHlPreview] = useState(true);

  // /harness#<slug> 딥링크: rehype-slug가 heading에 id를 달아 두면 해당 위치로 스크롤 (ProfileDocPage와 동일 패턴)
  useEffect(() => {
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    let r2 = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      if (r2) cancelAnimationFrame(r2);
    };
  }, [location.key, location.hash]);

  const components = makeComponents(hlPreview);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 shadow-sm">
        <p className="inline-flex items-center gap-2 text-xs text-[var(--muted)]">
          <Wrench className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
          다른 프로젝트 참고용 · 정본:{" "}
          <a
            href={CANONICAL_MD}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[var(--accent-2)] underline"
          >
            docs/harness-knowhow.md
            <span className="sr-only"> (새 창에서 열림)</span>
          </a>
        </p>
        <HighlightToggle on={hlPreview} onChange={setHlPreview} />
      </div>
      <article className="max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={components}>
          {harnessMd}
        </ReactMarkdown>
      </article>
    </div>
  );
}
