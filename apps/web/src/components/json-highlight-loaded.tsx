import { Highlight, themes } from "prism-react-renderer";
import Prism from "prismjs";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";

function pickTheme() {
  return document.documentElement.dataset.theme === "light" ? themes.oneLight : themes.oneDark;
}

export function HighlightCode({
  code,
  language,
  maxHeight = 256,
}: {
  code: string;
  language: string;
  maxHeight?: number;
}) {
  const theme = pickTheme();
  return (
    <Highlight prism={Prism} theme={theme} code={code} language={language}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={`${className} overflow-auto rounded border border-[var(--border)] font-mono text-xs leading-relaxed`}
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
}
