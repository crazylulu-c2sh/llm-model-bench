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
  // 런타임 오류가 난다. 빌드 후 dist의 ESM import만 골라 `node:sqlite`로 되돌린다.
  // (라인 시작 앵커 + `import ... from "sqlite"` 형태만 매칭 — 문자열 리터럴 내 우연한 일치 회피)
  async onSuccess() {
    const distDir = path.resolve("dist");
    const files = fs.readdirSync(distDir).filter((f) => f.endsWith(".js"));
    for (const f of files) {
      const p = path.join(distDir, f);
      const src = fs.readFileSync(p, "utf8");
      const fixed = src.replace(
        /^(\s*import[^"'\n]*from\s*)(["'])sqlite\2/gm,
        (_m, head, q) => `${head}${q}node:sqlite${q}`,
      );
      if (fixed !== src) fs.writeFileSync(p, fixed);
    }
  },
});
