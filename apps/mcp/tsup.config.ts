import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  // stdio 트랜스포트에서 npx/bin 직접 실행용 shebang. @llm-bench/shared는 번들에 포함.
  banner: { js: "#!/usr/bin/env node" },
  noExternal: ["@llm-bench/shared"],
});
