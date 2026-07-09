import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpConfig } from "./config.js";
import { BenchClient } from "./bench-client.js";
import { registerTools } from "./tools.js";

/** 도구가 등록된 McpServer를 만든다(트랜스포트 무관 — stdio·http 공용). */
export function buildServer(cfg: McpConfig): McpServer {
  const server = new McpServer(
    { name: "llm-bench", version: "0.0.1" },
    { capabilities: { tools: {}, logging: {} } },
  );
  const client = new BenchClient(cfg);
  registerTools(server, client, cfg);
  return server;
}
