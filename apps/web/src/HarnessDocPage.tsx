import { ArrowUp, ListTree, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { JsonCodeBlock, HighlightToggle } from "./components/JsonCodeBlock";
import { useI18n, type Locale } from "./i18n";

/** 정본(canonical) 마크다운은 저장소의 docs/harness-knowhow.<locale>.md — GitHub에서도 그대로 읽힙니다. */
const GITHUB_BLOB = "https://github.com/crazylulu-c2sh/llm-model-bench/blob/main";

// 로케일별 마크다운을 lazy 청크로 로드(정적 3중 import는 청크를 3배로 부풀린다). 활성 로케일만 다운로드된다.
const HARNESS_MD = import.meta.glob("../../../docs/harness-knowhow.*.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

function useHarnessMarkdown(locale: Locale): string | null {
  const [md, setMd] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const loader = HARNESS_MD[`../../../docs/harness-knowhow.${locale}.md`];
    loader?.().then((s) => {
      if (alive) setMd(s);
    });
    return () => {
      alive = false;
    };
    // 로케일 전환 시 이전 콘텐츠를 유지해 깜빡임을 줄인다(md는 새 값이 도착할 때만 교체).
  }, [locale]);
  return md;
}

type HrefKind =
  | { kind: "anchor"; url: string }
  | { kind: "internal"; url: string }
  | { kind: "external"; url: string };

/**
 * md 원본은 저장소-상대 경로(docs/…, apps/…)로 작성 → GitHub에서 정상 렌더.
 * 웹에서는 그런 상대 경로가 SPA 라우트로 404이므로 GitHub blob URL로 재작성한다.
 */
function resolveHref(href: string | undefined): HrefKind {
  if (!href) return { kind: "anchor", url: "#" };
  if (href.startsWith("#")) return { kind: "anchor", url: href };
  if (/^https?:\/\//.test(href)) return { kind: "external", url: href };
  if (href.startsWith("/")) return { kind: "internal", url: href };
  return { kind: "external", url: `${GITHUB_BLOB}/${href.replace(/^\.\//, "")}` };
}

/**
 * hlPreview·locale에 의존하지 않는 렌더러는 모듈 스코프 상수로 둔다 — 매 렌더 새 함수 정체성을 만들면
 * react-markdown이 heading DOM을 remount해 스크롤-스파이 측정이 죽는다. heading 컴포넌트는 로케일 의존이
 * 없으므로(마크다운 텍스트만 렌더) 여기 고정한다. 로케일 의존 크롬(외부 링크 sr-only)은 아래 팩토리로 분리.
 */
const STATIC_MD_COMPONENTS: Components = {
  h1: ({ node: _n, children, ...props }) => (
    <h1 className="mb-3 text-xl font-semibold tracking-tight text-[var(--foreground)]" {...props}>
      {children}
    </h1>
  ),
  h2: ({ node: _n, children, ...props }) => (
    <h2
      className="mt-8 mb-3 scroll-mt-4 border-b border-[var(--border)] pb-2 text-lg font-semibold text-[var(--foreground)]"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ node: _n, children, ...props }) => (
    <h3 className="mt-6 mb-2 scroll-mt-4 text-base font-semibold text-[var(--foreground)]" {...props}>
      {children}
    </h3>
  ),
  h4: ({ node: _n, children, ...props }) => (
    <h4 className="mt-4 mb-1 scroll-mt-4 text-sm font-semibold text-[var(--foreground)]" {...props}>
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
  // react-markdown은 펜스를 <pre><code>로 감싸므로, 블록 래핑은 code의 JsonCodeBlock(내부 <pre>)에 맡기고
  // pre는 그대로 통과시켜 <pre> 중첩을 피한다.
  pre: ({ children }) => <>{children}</>,
};

/** 외부 링크 sr-only 문구만 로케일 의존 → heading 정체성과 무관한 `a` 렌더러로 분리(remount 영향 없음). */
function makeAnchorComponent(newWindowText: string): Components["a"] {
  return ({ node: _n, href, children, ...props }) => {
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
          <span className="sr-only">{newWindowText}</span>
        </a>
      );
    }
    return (
      <a href={target.url} className="text-[var(--accent-2)] underline" {...props}>
        {children}
      </a>
    );
  };
}

/** code 렌더러만 hlPreview에 의존 → 별도 팩토리로 분리(헤더 등 나머지는 STATIC_MD_COMPONENTS로 고정 정체성 유지). */
function makeCodeComponent(hlPreview: boolean): Components["code"] {
  return ({ node: _n, className, children, ...props }) => {
    const language = /language-(\w+)/.exec(className ?? "")?.[1];
    if (language) {
      return <JsonCodeBlock code={String(children)} language={language} enabled={hlPreview} maxHeight={480} />;
    }
    return (
      <code className="rounded bg-[var(--surface)] px-1 font-mono text-xs text-[var(--foreground)]" {...props}>
        {children}
      </code>
    );
  };
}

type TocChild = { id: string; text: string };
type TocGroup = { id: string; text: string; children: TocChild[] };

/** 인라인 목차 헤딩(로케일별 슬러그)과 각주 라벨은 사이드바에서 제외. 아래는 슬러그 id(번역 대상 아님). */
// i18n-ignore-next-line
const TOC_EXCLUDE_IDS = new Set(["목차", "contents", "目次", "footnote-label"]);

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 해시 → heading 요소. 정확 id 미발견 시(로케일 전환으로 공유된 딥링크 등) 폴백:
 * 숫자 접두(`3-…`)나 부록 문자(`부록-a`/`appendix-a`/`付録-a`)로 같은 절을 찾는다.
 */
function findHeadingByHash(id: string): HTMLElement | null {
  const exact = document.getElementById(id);
  if (exact) return exact;
  const numeric = /^(\d+)(?:-|$)/.exec(id);
  if (numeric) {
    const el = Array.from(document.querySelectorAll<HTMLElement>("h2[id]")).find((h) =>
      h.id.startsWith(`${numeric[1]}-`),
    );
    if (el) return el;
  }
  const appendix = /(?:부록|appendix|付録)-([a-b])/i.exec(id);
  if (appendix) {
    const letter = appendix[1].toLowerCase();
    const el = Array.from(document.querySelectorAll<HTMLElement>("h2[id]")).find((h) =>
      /(?:부록|appendix|付録)-([a-b])/i.exec(h.id)?.[1]?.toLowerCase() === letter,
    );
    if (el) return el;
  }
  return null;
}

function scrollToHeading(id: string) {
  findHeadingByHash(id)?.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });
}

/** 스티키 헤더 높이(px) — 스크롤-스파이 활성 판정 및 사이드바 top 오프셋 기준. */
const HEADER_OFFSET = 96;

export default function HarnessDocPage() {
  const location = useLocation();
  const { locale, m } = useI18n();
  const h = m.docs.harness;
  const md = useHarnessMarkdown(locale);
  const [hlPreview, setHlPreview] = useState(true);
  const articleRef = useRef<HTMLElement>(null);
  const [toc, setToc] = useState<TocGroup[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [showTop, setShowTop] = useState(false);

  const canonicalMd = `${GITHUB_BLOB}/docs/harness-knowhow.${locale}.md`;
  const canonicalName = `docs/harness-knowhow.${locale}.md`;

  // heading은 STATIC_MD_COMPONENTS로 정체성 고정. 로케일 의존 `a`(sr-only)·hlPreview 의존 code만 재생성.
  const components = useMemo<Components>(
    () => ({
      ...STATIC_MD_COMPONENTS,
      a: makeAnchorComponent(h.newWindow),
      code: makeCodeComponent(hlPreview),
    }),
    [hlPreview, h.newWindow],
  );

  // 목차(h2 그룹 + h3 자식) 구성 + 스크롤 스파이 + 맨 위로 버튼. 콘텐츠(md) 교체 시 재수집.
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const heads = Array.from(root.querySelectorAll<HTMLElement>("h2[id], h3[id]")).filter(
      (el) => !TOC_EXCLUDE_IDS.has(el.id),
    );
    const groups: TocGroup[] = [];
    for (const el of heads) {
      const text = (el.textContent ?? "").trim();
      if (el.tagName === "H2") groups.push({ id: el.id, text, children: [] });
      else if (groups.length) groups[groups.length - 1].children.push({ id: el.id, text });
    }
    setToc(groups);
    if (heads.length === 0) return;

    let raf = 0;
    const recompute = () => {
      raf = 0;
      setShowTop(window.scrollY > 300);
      const doc = document.documentElement;
      if (window.innerHeight + Math.ceil(window.scrollY) >= doc.scrollHeight - 2) {
        setActiveId(heads[heads.length - 1].id);
        return;
      }
      let current = heads[0].id;
      for (const el of heads) {
        if (el.getBoundingClientRect().top - HEADER_OFFSET <= 1) current = el.id;
        else break;
      }
      setActiveId(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(recompute);
    };
    recompute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [md]);

  const onTocClick = (id: string) => (e: MouseEvent) => {
    e.preventDefault();
    scrollToHeading(id);
    window.history.replaceState(null, "", `#${id}`);
    setActiveId(id);
  };

  // /harness#<slug> 딥링크: rehype-slug가 heading에 id를 달아 두면 해당 위치로 스크롤(폴백 포함).
  useEffect(() => {
    if (!location.hash || !md) return;
    const id = decodeURIComponent(location.hash.slice(1));
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => scrollToHeading(id));
    });
    return () => {
      cancelAnimationFrame(r1);
      if (r2) cancelAnimationFrame(r2);
    };
  }, [location.key, location.hash, md]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 shadow-sm">
        <p className="inline-flex items-center gap-2 text-xs text-[var(--muted)]">
          <Wrench className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
          {h.canonicalLead}{" "}
          <a
            href={canonicalMd}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[var(--accent-2)] underline"
          >
            {canonicalName}
            <span className="sr-only">{h.newWindow}</span>
          </a>
        </p>
        <HighlightToggle on={hlPreview} onChange={setHlPreview} />
      </div>
      <div className="xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] xl:items-start xl:gap-8">
        {toc.length > 0 ? (
          <nav
            aria-label={h.tocAria}
            className="sticky top-24 hidden max-h-[calc(100vh-7rem)] self-start overflow-y-auto pl-1 text-sm xl:block"
          >
            <p className="mb-2 inline-flex items-center gap-1.5 font-semibold text-[var(--foreground)]">
              <ListTree className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
              {h.tocTitle}
            </p>
            <ul className="space-y-0.5 border-l border-[var(--border)]">
              {toc.map((g) => {
                const groupActive = g.id === activeId || g.children.some((c) => c.id === activeId);
                return (
                  <li key={g.id}>
                    <a
                      href={`#${g.id}`}
                      onClick={onTocClick(g.id)}
                      aria-current={groupActive ? "location" : undefined}
                      className={`-ml-px block border-l-2 py-1 pl-3 leading-snug no-underline transition-colors ${
                        groupActive
                          ? "border-[var(--accent-2)] font-medium text-[var(--foreground)]"
                          : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      {g.text}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}
        <article ref={articleRef} className="min-w-0 max-w-none">
          {md ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSlug]}
              remarkRehypeOptions={{ footnoteLabel: h.footnoteLabel }}
              components={components}
            >
              {md}
            </ReactMarkdown>
          ) : (
            <p className="text-sm text-[var(--muted)]" aria-busy="true">
              {m.bench.docLoading}
            </p>
          )}
        </article>
      </div>
      {showTop ? (
        <button
          type="button"
          onClick={() => {
            window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
            document.getElementById("main")?.focus({ preventScroll: true });
          }}
          aria-label={h.backToTop}
          className="fixed bottom-6 right-6 z-30 inline-flex size-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] shadow-md transition-colors hover:text-[var(--foreground)]"
        >
          <ArrowUp className="size-5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
