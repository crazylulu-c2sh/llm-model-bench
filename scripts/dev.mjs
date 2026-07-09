import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portsPath = path.join(root, "scripts", "dev-ports.json");

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

function loadPorts() {
  if (process.env.DEV_SERVER_PORT && process.env.VITE_DEV_PORT) {
    return {
      serverPort: Number(process.env.DEV_SERVER_PORT),
      vitePort: Number(process.env.VITE_DEV_PORT),
    };
  }
  if (!existsSync(portsPath)) {
    console.error(
      `[dev] missing ${path.relative(root, portsPath)}. Create it with { "serverPort": 20000-20999, "vitePort": 21000-21999 } or set DEV_SERVER_PORT and VITE_DEV_PORT.`,
    );
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(portsPath, "utf8"));
  const serverPort = Number(raw.serverPort);
  const vitePort = Number(raw.vitePort);
  if (!Number.isInteger(serverPort) || serverPort < 20000 || serverPort > 20999) {
    console.error(`[dev] invalid serverPort in dev-ports.json: ${raw.serverPort}`);
    process.exit(1);
  }
  if (!Number.isInteger(vitePort) || vitePort < 21000 || vitePort > 21999) {
    console.error(`[dev] invalid vitePort in dev-ports.json: ${raw.vitePort}`);
    process.exit(1);
  }
  // mcpPort는 선택(DEV_WITH_MCP=1일 때만 사용). 대역 22000-22999.
  const mcpPort = Number(process.env.MCP_DEV_PORT ?? raw.mcpPort ?? 22090);
  return { serverPort, vitePort, mcpPort };
}

const { serverPort, vitePort, mcpPort } = loadPorts();
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
