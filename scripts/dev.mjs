import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portsPath = path.join(root, "scripts", "dev-ports.json");

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
  return { serverPort, vitePort };
}

const { serverPort, vitePort } = loadPorts();

const env = {
  ...process.env,
  PORT: String(serverPort),
  VITE_API_URL: `http://127.0.0.1:${serverPort}`,
  VITE_DEV_PORT: String(vitePort),
};

console.log(`[dev] server PORT=${serverPort} vite PORT=${vitePort} (from scripts/dev-ports.json)`);

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

function shutdown() {
  server.kill("SIGINT");
  web.kill("SIGINT");
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
