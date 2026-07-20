import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portsPath = path.join(root, "scripts", "dev-ports.json");

/**
 * dev 포트를 해석한다. 실패하면 사람이 읽을 메시지를 담아 throw —
 * 호출부가 exit(dev.mjs)할지 경고만 하고 넘어갈지(dev-kill.mjs) 결정한다.
 */
export function loadDevPorts() {
  if (process.env.DEV_SERVER_PORT && process.env.VITE_DEV_PORT) {
    return {
      serverPort: Number(process.env.DEV_SERVER_PORT),
      vitePort: Number(process.env.VITE_DEV_PORT),
      mcpPort: Number(process.env.MCP_DEV_PORT ?? 22090),
    };
  }
  if (!existsSync(portsPath)) {
    throw new Error(
      `missing ${path.relative(root, portsPath)}. Create it with { "serverPort": 20000-20999, "vitePort": 21000-21999 } or set DEV_SERVER_PORT and VITE_DEV_PORT.`,
    );
  }
  const raw = JSON.parse(readFileSync(portsPath, "utf8"));
  const serverPort = Number(raw.serverPort);
  const vitePort = Number(raw.vitePort);
  if (!Number.isInteger(serverPort) || serverPort < 20000 || serverPort > 20999) {
    throw new Error(`invalid serverPort in dev-ports.json: ${raw.serverPort}`);
  }
  if (!Number.isInteger(vitePort) || vitePort < 21000 || vitePort > 21999) {
    throw new Error(`invalid vitePort in dev-ports.json: ${raw.vitePort}`);
  }
  // mcpPort는 선택(DEV_WITH_MCP=1일 때만 사용). 대역 22000-22999.
  const mcpPort = Number(process.env.MCP_DEV_PORT ?? raw.mcpPort ?? 22090);
  return { serverPort, vitePort, mcpPort };
}
