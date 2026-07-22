import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

// 하드코딩 한국어 스캐너 — no-hardcoded-korean 래칫과 시드 생성 스크립트가 공유하는 순수 로직.
// 문자열 리터럴·템플릿·JSX 텍스트만 검사한다(주석은 트리비아라 자동 제외 → "주석은 한국어 유지" 규칙 충족).

const HANGUL = /[가-힣]/;

/** apps/web 루트(이 파일 기준 ../../.. = apps/web). */
export const WEB_SRC_ROOT = join(__dirname, "..");

// 스캔 제외(영구): ko 카탈로그·로케일별 콘텐츠 모듈·테스트·스캐너 자신.
const ALLOW_PATTERNS: RegExp[] = [
  /(^|\/)i18n\/messages\/ko\//,
  /(^|\/)i18n\/korean-scan\.ts$/,
  /(^|\/)content\/[^/]+\/(ko|en|ja)\.tsx?$/,
  /\.test\.tsx?$/,
];

const ESCAPE_HATCH = "i18n-ignore-next-line";

function isAllowlisted(relPath: string): boolean {
  return ALLOW_PATTERNS.some((re) => re.test(relPath));
}

function walkFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

/** 한국어 리터럴이 escape-hatch로 명시 허용됐는지(직전 줄 주석). */
function hasEscapeHatch(source: string, pos: number): boolean {
  const before = source.lastIndexOf("\n", pos - 1);
  const lineStart = source.lastIndexOf("\n", before - 1) + 1;
  return source.slice(lineStart, before).includes(ESCAPE_HATCH);
}

function fileHasHardcodedKorean(absPath: string): boolean {
  const source = readFileSync(absPath, "utf8");
  const sf = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      if (HANGUL.test(node.text) && !hasEscapeHatch(source, node.getStart(sf))) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** apps/web/src 하위에서 하드코딩 한국어를 가진 파일의 상대 경로(web-src 기준) 목록. 정렬됨. */
export function scanHardcodedKoreanFiles(): string[] {
  const files: string[] = [];
  walkFiles(WEB_SRC_ROOT, files);
  const offenders: string[] = [];
  for (const abs of files) {
    const rel = relative(WEB_SRC_ROOT, abs).split("\\").join("/");
    if (isAllowlisted(rel)) continue;
    if (fileHasHardcodedKorean(abs)) offenders.push(rel);
  }
  return offenders.sort();
}
