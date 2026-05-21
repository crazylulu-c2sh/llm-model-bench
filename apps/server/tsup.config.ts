import { defineConfig } from "tsup";
import fs from "node:fs";
import path from "node:path";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  clean: true,
  sourcemap: true,
  noExternal: ["@llm-bench/shared"],
  // esbuild의 builtin 목록에 `node:sqlite`가 없어 `node:` prefix를 떼버려 `Cannot find package 'sqlite'`
  // 런타임 오류가 난다. 빌드 후 dist의 ESM import / 동적 import 형태를 모두 `node:sqlite`로 되돌린다.
  // (`scripts/verify-bundle.mjs`가 빌드 후 한 번 더 게이트 — 같은 패턴 유지)
  async onSuccess() {
    const distDir = path.resolve("dist");
    // 정적 ESM: `^import ... from "sqlite"`
    const staticRe = /^(\s*import[^"'\n]*from\s*)(["'])sqlite\2/gm;
    // 동적: `import("sqlite")` — 라인 어디에 있어도 매칭
    const dynamicRe = /(\bimport\s*\(\s*)(["'])sqlite\2/g;
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p);
        else if (name.endsWith(".js")) {
          const src = fs.readFileSync(p, "utf8");
          const fixed = src
            .replace(staticRe, (_m, head, q) => `${head}${q}node:sqlite${q}`)
            .replace(dynamicRe, (_m, head, q) => `${head}${q}node:sqlite${q}`);
          if (fixed !== src) fs.writeFileSync(p, fixed);
        }
      }
    };
    walk(distDir);
  },
});
