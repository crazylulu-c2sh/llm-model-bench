import { readFileSync } from "node:fs";
import { join } from "node:path";
import GithubSlugger from "github-slugger";
import { describe, expect, it } from "vitest";

// 하네스 문서 로케일 분리(.ko/.en/.ja)의 구조 정합성 게이트. rehype-slug와 동일한 github-slugger로
// heading 슬러그를 계산해, 각 파일의 내부 앵커 링크가 자기 heading으로 해석되는지 등을 검증한다.
const DOCS = join(__dirname, "../../../docs");
const LOCALES = ["ko", "en", "ja"] as const;

function read(locale: string): string {
  return readFileSync(join(DOCS, `harness-knowhow.${locale}.md`), "utf8");
}

/** 펜스 밖의 라인만(코드 블록 내부의 `#`·`[...]`를 heading/링크로 오인하지 않도록). */
function stripFences(md: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of md.split("\n")) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      out.push("");
      continue;
    }
    out.push(inFence ? "" : line);
  }
  return out.join("\n");
}

function headings(md: string): { depth: number; text: string }[] {
  return stripFences(md)
    .split("\n")
    .map((l) => /^(#{1,6})\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ depth: m[1].length, text: m[2].trim() }));
}

/** github-slugger로 heading id 집합 계산(중복 시 -1, -2 … 부여는 rehype-slug와 동일). */
function headingIds(md: string): Set<string> {
  const slugger = new GithubSlugger();
  const ids = new Set<string>();
  for (const h of headings(md)) ids.add(slugger.slug(h.text));
  return ids;
}

function inPageAnchors(md: string): string[] {
  const body = stripFences(md);
  const anchors: string[] = [];
  const re = /\]\(#([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) anchors.push(decodeURIComponent(m[1]));
  return anchors;
}

function footnoteKeys(md: string): string[] {
  return (stripFences(md).match(/^\[\^([a-z0-9-]+)\]:/gm) ?? []).sort();
}

function fences(md: string): string[] {
  return md.match(/```[\s\S]*?```/g) ?? [];
}

function sectionNumbers(md: string): string[] {
  return headings(md)
    .filter((h) => h.depth === 2)
    .map((h) => /^(\d+)\./.exec(h.text)?.[1])
    .filter((n): n is string => n !== undefined);
}

describe("harness 문서 로케일 정합성", () => {
  it("각 파일의 내부 앵커 링크가 자기 heading으로 해석된다", () => {
    for (const locale of LOCALES) {
      const md = read(locale);
      const ids = headingIds(md);
      const unresolved = inPageAnchors(md).filter((a) => !ids.has(a));
      expect(unresolved, `${locale}: 해석 불가 앵커`).toEqual([]);
    }
  });

  it("절 번호 골격(## <n>.)이 3로케일 동일", () => {
    const ko = sectionNumbers(read("ko"));
    expect(ko.length).toBeGreaterThanOrEqual(12);
    for (const locale of ["en", "ja"] as const) {
      expect(sectionNumbers(read(locale)), `${locale} 절 번호`).toEqual(ko);
    }
  });

  it("h3 개수가 3로케일 동일", () => {
    const count = (md: string) => headings(md).filter((h) => h.depth === 3).length;
    const ko = count(read("ko"));
    expect(count(read("en"))).toBe(ko);
    expect(count(read("ja"))).toBe(ko);
  });

  it("코드 펜스가 3로케일 바이트 동일(코드는 언어 중립)", () => {
    const ko = fences(read("ko"));
    expect(ko.length).toBeGreaterThan(0);
    expect(fences(read("en"))).toEqual(ko);
    expect(fences(read("ja"))).toEqual(ko);
  });

  it("각주 정의 키가 3로케일 동일", () => {
    const ko = footnoteKeys(read("ko"));
    expect(ko.length).toBeGreaterThan(0);
    expect(footnoteKeys(read("en"))).toEqual(ko);
    expect(footnoteKeys(read("ja"))).toEqual(ko);
  });
});
