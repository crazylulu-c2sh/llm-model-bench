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
  // 런타임 오류가 난다. 빌드 후 dist의 ESM import를 `node:sqlite`로 되돌린다.
  async onSuccess() {
    const distDir = path.resolve("dist");
    const files = fs.readdirSync(distDir).filter((f) => f.endsWith(".js"));
    for (const f of files) {
      const p = path.join(distDir, f);
      const src = fs.readFileSync(p, "utf8");
      const fixed = src.replace(
        /from\s*(["'])sqlite\1/g,
        (_m, q) => `from ${q}node:sqlite${q}`,
      );
      if (fixed !== src) fs.writeFileSync(p, fixed);
    }
  },
});
