import { spawn } from "node:child_process";
import { loadDevPorts, root } from "./dev-ports.mjs";

// engine-strict는 install 시점만 막는다 — 이미 설치된 환경에서 다른 Node로 dev를 띄우면
// 서버의 `node:sqlite` import가 실패하므로 여기서 한 번 더 게이트.
const major = Number(process.versions.node.split(".")[0]);
if (major !== 24) {
  console.error(
    `[dev] Node ${process.versions.node} 감지 — 이 저장소는 Node 24.x 가 필요합니다. ` +
      `\`.nvmrc\`를 참고해 \`nvm use\` / \`fnm use\` / \`volta install node@24\` 등으로 전환하세요.`,
  );
  process.exit(1);
}

let ports;
try {
  ports = loadDevPorts();
} catch (err) {
  console.error(`[dev] ${err.message}`);
  process.exit(1);
}
const { serverPort, vitePort, mcpPort } = ports;
const withMcp = process.env.DEV_WITH_MCP === "1";
if (withMcp && (!Number.isInteger(mcpPort) || mcpPort < 22000 || mcpPort > 22999)) {
  console.error(`[dev] invalid mcpPort (need 22000-22999): ${mcpPort}`);
  process.exit(1);
}

const env = {
  ...process.env,
  PORT: String(serverPort),
  VITE_API_URL: `http://127.0.0.1:${serverPort}`,
  VITE_DEV_PORT: String(vitePort),
};

console.log(
  `[dev] server PORT=${serverPort} vite PORT=${vitePort}` +
    (withMcp ? ` mcp PORT=${mcpPort}` : "") +
    ` (from scripts/dev-ports.json)`,
);

const server = spawn("pnpm", ["--filter", "@llm-bench/server", "run", "dev"], {
  cwd: root,
  env,
  stdio: "inherit",
});

const web = spawn("pnpm", ["--filter", "@llm-bench/web", "dev"], {
  cwd: root,
  env,
  stdio: "inherit",
});

// DEV_WITH_MCP=1일 때만 MCP(http 트랜스포트)도 함께 띄운다 — 기본 dev UX는 무변경.
const mcp = withMcp
  ? spawn("pnpm", ["--filter", "@llm-bench/mcp", "run", "dev"], {
      cwd: root,
      env: {
        ...env,
        MCP_TRANSPORT: "http",
        MCP_HTTP_HOST: "127.0.0.1",
        MCP_PORT: String(mcpPort),
        BENCH_API_URL: `http://127.0.0.1:${serverPort}`,
        BENCH_API_VERSION: "/api/v1",
      },
      stdio: "inherit",
    })
  : null;

function shutdown() {
  server.kill("SIGINT");
  web.kill("SIGINT");
  mcp?.kill("SIGINT");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.on("exit", (code) => {
  if (code && code !== 0) shutdown();
});
web.on("exit", (code) => {
  if (code && code !== 0) shutdown();
});
mcp?.on("exit", (code) => {
  if (code && code !== 0) shutdown();
});
