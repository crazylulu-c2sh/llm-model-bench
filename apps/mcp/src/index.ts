import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { startHttp } from "./transport-http.js";
import { startStdio } from "./transport-stdio.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (cfg.transport === "http") {
    await startHttp(cfg);
  } else {
    const server = buildServer(cfg);
    await startStdio(server);
  }
}

main().catch((e) => {
  console.error("[llm-bench-mcp] fatal:", e);
  process.exit(1);
});
