import { forwardRef } from "react";
import { Highlight, themes } from "prism-react-renderer";
import Prism from "prismjs";
import { useI18n } from "../i18n";
// Prism 언어 등록 — 의존 순서 고정 (임의 재정렬 금지):
// typescript(→javascript 내장), jsx(→markup·javascript 내장), tsx(→jsx+typescript 선행 필수)
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";

function pickTheme() {
  return document.documentElement.dataset.theme === "light" ? themes.oneLight : themes.oneDark;
}

export const HighlightCode = forwardRef<
  HTMLPreElement,
  {
    code: string;
    language: string;
    maxHeight?: number;
  }
>(function HighlightCode({ code, language, maxHeight = 256 }, ref) {
  const { m } = useI18n();
  const theme = pickTheme();
  return (
    <Highlight prism={Prism} theme={theme} code={code} language={language}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          ref={ref}
          tabIndex={0}
          aria-label={m.common.codeScrollable}
          className={`${className} max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded border border-[var(--border)] font-mono text-xs leading-relaxed`}
          style={{
            ...style,
            margin: 0,
            padding: "0.75rem",
            maxHeight,
            background: "var(--surface)",
          }}
        >
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, key) => {
                const tp = getTokenProps({ token });
                return <span key={key} {...tp} />;
              })}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
});
