import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpConfig } from "./config.js";
import { buildServer } from "./server.js";

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * streamable-HTTP 트랜스포트(agent→MCP). Web 표준 Request/Response 변형이라 Hono와 직접 맞물린다.
 * 세션당 McpServer 하나. DNS-rebinding 방어(allowedHosts/allowedOrigins) + 선택 bearer(MCP_HTTP_TOKEN).
 */
export async function startHttp(cfg: McpConfig): Promise<void> {
  // 비루프백 바인드 + 토큰 없음은 위험 신호 — 강하게 경고한다(Docker에선 컨테이너 내부 통신을 위해
  // 0.0.0.0 바인드가 필요하고 포트를 publish하지 않으면 안전하므로 hard-exit 대신 경고). 실제 방어는
  // DNS-rebinding Host 검증(allowedHosts). 호스트로 포트를 노출할 땐 반드시 MCP_HTTP_TOKEN을 설정할 것.
  if (!isLoopbackHost(cfg.httpHost) && !cfg.httpToken) {
    console.error(
      `[llm-bench-mcp] WARNING: binding non-loopback host ${cfg.httpHost} without MCP_HTTP_TOKEN. ` +
        "If this port is reachable from the network, set MCP_HTTP_TOKEN (and MCP_ALLOWED_ORIGINS). " +
        "Container-internal (unpublished) binds are safe.",
    );
  }

  // Host 검증은 host:port 전체 문자열과 비교하므로 실제 바인드 host:port 형태를 허용 목록에 넣는다.
  // (DNS-rebinding 공격은 원 도메인이 Host로 오므로 여기 없으면 차단됨.)
  const allowedHosts = Array.from(
    new Set([
      ...cfg.allowedHosts,
      `${cfg.httpHost}:${cfg.httpPort}`,
      `127.0.0.1:${cfg.httpPort}`,
      `localhost:${cfg.httpPort}`,
    ]),
  );

  const transports: Record<string, WebStandardStreamableHTTPServerTransport> = {};
  const app = new Hono();

  const bearerOk = (req: Request): boolean => {
    if (!cfg.httpToken) return true;
    return req.headers.get("authorization") === `Bearer ${cfg.httpToken}`;
  };

  const newTransport = async (): Promise<WebStandardStreamableHTTPServerTransport> => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports[sid] = transport;
      },
      enableDnsRebindingProtection: true,
      allowedHosts,
      // 빈 배열은 "모든 origin 거부"로 해석되므로 미설정 시 undefined(= origin 검증 비활성).
      // 주 방어는 Host 검증(allowedHosts); origin 제한은 MCP_ALLOWED_ORIGINS 설정 시에만.
      allowedOrigins: cfg.allowedOrigins.length ? cfg.allowedOrigins : undefined,
    });
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };
    const server = buildServer(cfg);
    await server.connect(transport);
    return transport;
  };

  app.all("/mcp", async (c) => {
    const req = c.req.raw;
    if (!bearerOk(req)) return c.json({ error: "unauthorized" }, 401);
    const sessionId = req.headers.get("mcp-session-id") ?? undefined;

    if (c.req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (sessionId && transports[sessionId]) {
        return transports[sessionId].handleRequest(req, { parsedBody: body });
      }
      if (isInitializeRequest(body)) {
        const transport = await newTransport();
        return transport.handleRequest(req, { parsedBody: body });
      }
      return c.json({ error: "invalid_session_or_not_initialize" }, 400);
    }

    // GET(서버→클라 SSE) / DELETE(세션 종료)는 기존 세션 필요.
    if (sessionId && transports[sessionId]) {
      return transports[sessionId].handleRequest(req);
    }
    return c.json({ error: "no_session" }, 400);
  });

  serve({ fetch: app.fetch, hostname: cfg.httpHost, port: cfg.httpPort }, (info) => {
    console.error(`[llm-bench-mcp] http transport on http://${cfg.httpHost}:${info.port}/mcp`);
  });
}
