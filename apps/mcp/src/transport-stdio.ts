import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * stdio 트랜스포트로 서버를 연결한다(데스크톱 MCP 클라이언트가 프로세스를 spawn).
 * stdout은 프로토콜 채널이므로 모든 진단 로그는 stderr(console.error)로만 낸다.
 */
export async function startStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[llm-bench-mcp] stdio transport ready");
}
