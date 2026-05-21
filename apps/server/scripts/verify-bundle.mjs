// dist 번들이 `node:sqlite`의 prefix 보존을 잃지 않았는지 검증.
// esbuild가 builtin alias 목록에 `sqlite`가 없는 경우 `from "node:sqlite"`를 `from "sqlite"`로
// 치환해버려 런타임에 `Cannot find package 'sqlite'`로 깨진다. tsup.config.ts의 post-build sed가
// 이를 되돌리지만, 미래의 tsup/esbuild 업그레이드나 ESM 형식 변경으로 회피책이 약해질 수 있어
// 빌드 단계에서 한 번 더 강제로 잡는다.
//
// 1) 정적 분석: dist 내 모든 .js에서 `import ... "sqlite"` 또는 `import("sqlite")` 부재 확인
// 2) 런타임 스모크: DB 청크를 실제로 동적 import해서 resolution 실패도 잡음
//    (index.js는 serve()가 listen하므로 import 대상에서 제외)

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

const bad = [];
const jsFiles = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (name.endsWith(".js")) {
      jsFiles.push(p);
      const src = readFileSync(p, "utf8");
      // 정적 import + 동적 import 모두 검사 (라인 어디에 있어도) — 다만 `node:sqlite`는 제외
      if (
        /(?:from|\bimport\s*\()\s*(["'])sqlite\1/.test(src)
      ) {
        bad.push(p);
      }
    }
  }
}

walk(distDir);

if (bad.length > 0) {
  console.error(`[verify-bundle] bare 'sqlite' import detected — must be 'node:sqlite':`);
  for (const f of bad) console.error(`  - ${path.relative(process.cwd(), f)}`);
  process.exit(1);
}

// 런타임 스모크: index.js를 제외한 모든 청크를 dynamic import해 resolution을 강제.
// (index.js는 serve()로 listen하므로 제외 — 그 외 청크는 모듈 평가 시 부수 효과 없음.)
const importable = jsFiles.filter((p) => path.basename(p) !== "index.js");

for (const p of importable) {
  try {
    await import(pathToFileURL(p).href);
  } catch (e) {
    console.error(`[verify-bundle] runtime import failed for ${path.relative(process.cwd(), p)}:`);
    console.error(`  ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

console.log(
  `[verify-bundle] OK — ${jsFiles.length} files scanned, ${importable.length} chunks imported successfully.`,
);
