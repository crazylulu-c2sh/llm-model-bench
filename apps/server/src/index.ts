import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";

// CORS + 인증 + 라우트(/api, /api/v1)는 createApp이 담당. 정적 서빙은 SPA 폴백이라 그 뒤에 붙인다.
const app = createApp();

/** `WEB_DIST_PATH`가 있으면 Vite `dist`를 같은 포트에서 서빙(단일 PM2/Node 프로세스). */
const webDistEnv = process.env.WEB_DIST_PATH?.trim();
if (webDistEnv) {
  const webDist = path.resolve(process.cwd(), webDistEnv);
  if (existsSync(webDist)) {
    app.use(
      "/*",
      serveStatic({
        root: webDist,
        rewriteRequestPath: (p) => {
          const rel = p.startsWith("/") ? p.slice(1) : p;
          return rel || "index.html";
        },
      }),
    );
    app.get("*", (c) => {
      if (c.req.path.startsWith("/api")) {
        return c.json({ error: "not_found" }, 404);
      }
      const indexPath = path.join(webDist, "index.html");
      if (!existsSync(indexPath)) {
        return c.text("index.html not found", 404);
      }
      return c.html(readFileSync(indexPath, "utf-8"));
    });
    console.log(`[llm-bench-server] serving web dist from ${webDist}`);
  } else {
    console.warn(`[llm-bench-server] WEB_DIST_PATH set but missing: ${webDist}`);
  }
}

const port = Number(process.env.PORT ?? 20080);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`llm-bench-server listening on http://localhost:${info.port}`);
});

// 정상 종료(SIGTERM/SIGINT) 시 SQLite WAL truncate 후 close — Docker/PM2 운영에서 WAL 사이즈 폭주 방지
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, async () => {
    try {
      const dbMod = await import("./db/database.js");
      dbMod.closeProdBenchDatabase();
    } catch {
      // DB 모듈이 로드된 적 없으면 무시
    }
    process.exit(0);
  });
}
