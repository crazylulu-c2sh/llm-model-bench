const path = require("node:path");

/** API + 정적 UI를 한 Node 프로세스에서 제공 (`WEB_DIST_PATH` → 서버가 `dist` 서빙). */
module.exports = {
  apps: [
    {
      name: "llm-bench",
      cwd: path.join(__dirname, "apps/server"),
      script: "dist/index.js",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 20080,
        BENCH_DB_PATH: path.join(__dirname, "apps/server/data/bench.sqlite"),
        WEB_DIST_PATH: path.join(__dirname, "apps/web/dist"),
      },
    },
  ],
};
