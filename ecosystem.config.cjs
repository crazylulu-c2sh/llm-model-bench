const path = require("node:path");

/**
 * API + 정적 UI를 한 Node 프로세스에서 제공 (`WEB_DIST_PATH` → 서버가 `dist` 서빙).
 * MCP 서버(http 트랜스포트)는 별도 프로세스로 벤치 API를 프록시한다.
 * 시크릿(BENCH_API_KEYS/BENCH_API_KEY/MCP_HTTP_TOKEN)은 커밋하지 말고 실제 환경에서 주입한다.
 */
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
    {
      name: "llm-bench-mcp",
      cwd: path.join(__dirname, "apps/mcp"),
      script: "dist/index.js",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        MCP_TRANSPORT: "http",
        MCP_HTTP_HOST: "127.0.0.1",
        MCP_PORT: 20090,
        BENCH_API_URL: "http://127.0.0.1:20080",
        BENCH_API_VERSION: "/api/v1",
        // BENCH_API_KEY / MCP_HTTP_TOKEN / MCP_ALLOWED_ORIGINS 는 실제 환경에서 주입.
      },
    },
  ],
};
