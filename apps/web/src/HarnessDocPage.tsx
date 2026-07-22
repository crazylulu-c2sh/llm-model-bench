import { ArrowUp, ListTree, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
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

/**
 * hlPreview에 의존하지 않는 렌더러는 모듈 스코프 상수로 둔다 — 매 렌더 새 함수 정체성을 만들면
 * react-markdown이 heading DOM을 remount해 스크롤-스파이 IntersectionObserver/측정이 죽는다.
 * scroll-mt-4는 전역 html{scroll-padding-top}과 합쳐 헤더 아래로 앵커가 묻히지 않게 한다(ProfileDocPage와 동일).
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
    // react-markdown은 펜스를 <pre><code>로 감싸므로, 블록 래핑은 code의 JsonCodeBlock(내부 <pre>)에 맡기고
    // pre는 그대로 통과시켜 <pre> 중첩을 피한다.
    pre: ({ children }) => <>{children}</>,
};

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

/** 마크다운 인라인 목차와 각주 라벨은 사이드바에서 제외. */
const TOC_EXCLUDE_IDS = new Set(["목차--contents", "footnote-label"]);

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** heading id로 부드럽게 스크롤(모션 최소화 존중). scroll-margin-top은 index.css/컴포넌트가 처리. */
function scrollToHeading(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

/** 스티키 헤더 높이(px) — 스크롤-스파이 활성 판정 및 사이드바 top 오프셋 기준. */
const HEADER_OFFSET = 96;

export default function HarnessDocPage() {
  const location = useLocation();
  const [hlPreview, setHlPreview] = useState(true);
  const articleRef = useRef<HTMLElement>(null);
  const [toc, setToc] = useState<TocGroup[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [showTop, setShowTop] = useState(false);

  // heading은 STATIC_MD_COMPONENTS로 정체성이 고정돼 remount되지 않으므로, 마운트 시 한 번 수집한 노드가 유효하다.
  const components = useMemo<Components>(() => ({ ...STATIC_MD_COMPONENTS, code: makeCodeComponent(hlPreview) }), [hlPreview]);

  // 목차(h2 그룹 + h3 자식) 구성 + 스크롤 위치 기반 스파이 + 맨 위로 버튼 노출을 하나의 스크롤 리스너로 처리.
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const heads = Array.from(root.querySelectorAll<HTMLElement>("h2[id], h3[id]")).filter(
      (h) => !TOC_EXCLUDE_IDS.has(h.id),
    );
    const groups: TocGroup[] = [];
    for (const h of heads) {
      const text = (h.textContent ?? "").trim();
      if (h.tagName === "H2") groups.push({ id: h.id, text, children: [] });
      else if (groups.length) groups[groups.length - 1].children.push({ id: h.id, text });
    }
    setToc(groups);
    if (heads.length === 0) return;

    let raf = 0;
    const recompute = () => {
      raf = 0;
      setShowTop(window.scrollY > 300);
      const doc = document.documentElement;
      // 문서 하단에 닿으면 마지막 heading을 활성(밴드 방식이 놓치는 마지막 섹션 보정).
      if (window.innerHeight + Math.ceil(window.scrollY) >= doc.scrollHeight - 2) {
        setActiveId(heads[heads.length - 1].id);
        return;
      }
      // 그 외에는 헤더선(HEADER_OFFSET) 위로 올라온 마지막 heading을 활성(문서 순서 가정). 최상단은 첫 heading.
      let current = heads[0].id;
      for (const h of heads) {
        if (h.getBoundingClientRect().top - HEADER_OFFSET <= 1) current = h.id;
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
  }, []);

  const onTocClick = (id: string) => (e: MouseEvent) => {
    e.preventDefault();
    scrollToHeading(id);
    window.history.replaceState(null, "", `#${id}`);
    setActiveId(id);
  };

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
      <div className="xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] xl:items-start xl:gap-8">
        {toc.length > 0 ? (
          <nav
            aria-label="이 페이지 목차"
            className="sticky top-24 hidden max-h-[calc(100vh-7rem)] self-start overflow-y-auto pl-1 text-sm xl:block"
          >
            <p className="mb-2 inline-flex items-center gap-1.5 font-semibold text-[var(--foreground)]">
              <ListTree className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
              이 페이지
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
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]} components={components}>
            {harnessMd}
          </ReactMarkdown>
        </article>
      </div>
      {showTop ? (
        <button
          type="button"
          onClick={() => {
            window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
            // 이 버튼은 상단 도달 시 unmount되므로 포커스가 <body>로 유실되지 않게 본문 상단으로 이동시킨다.
            document.getElementById("main")?.focus({ preventScroll: true });
          }}
          aria-label="맨 위로"
          className="fixed bottom-6 right-6 z-30 inline-flex size-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] shadow-md transition-colors hover:text-[var(--foreground)]"
        >
          <ArrowUp className="size-5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
