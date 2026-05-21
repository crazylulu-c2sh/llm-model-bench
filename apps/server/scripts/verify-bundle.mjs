// dist 번들이 `node:sqlite`의 prefix 보존을 잃지 않았는지 검증.
// esbuild가 builtin alias 목록에 `sqlite`가 없는 경우 `from "node:sqlite"`를 `from "sqlite"`로
// 치환해버려 런타임에 `Cannot find package 'sqlite'`로 깨진다. tsup.config.ts의 post-build sed가
// 이를 되돌리지만, 미래의 tsup/esbuild 업그레이드나 ESM 형식 변경으로 회피책이 약해질 수 있어
// 빌드 단계에서 한 번 더 강제로 잡는다.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

let bad = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (name.endsWith(".js")) {
      const src = readFileSync(p, "utf8");
      // 라인 시작의 ESM import만 검사 — 문자열 리터럴 내 우연한 일치 회피
      if (/^\s*import[^"']*["']sqlite["']/m.test(src)) {
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
console.log("[verify-bundle] node:sqlite import prefix preserved.");
