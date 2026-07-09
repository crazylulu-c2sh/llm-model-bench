import { Hono } from "hono";
import { cors } from "hono/cors";
import { benchApiKeyAuth } from "./middleware/api-key-auth.js";
import { registerApiRoutes } from "./routes/register.js";

/**
 * CORS + 인증 + 라우트를 붙인 Hono 앱을 만든다(정적 서빙·serve()는 index.ts가 담당).
 * env를 호출 시점에 읽으므로 통합 테스트가 env를 세팅한 뒤 새 앱을 만들 수 있다.
 */
export function createApp(): Hono {
  const app = new Hono();

  // CORS — origin은 `BENCH_CORS_ORIGINS`(콤마)로 좁힐 수 있고 기본 `*`. `DELETE`·`x-api-key` 추가.
  // 인증이 헤더 기반이므로 credentials는 켜지 않는다(origin:* 유지). CORS는 브라우저 정책일 뿐
  // 서버 접근제어가 아니다 — 실제 접근제어는 benchApiKeyAuth.
  const corsOrigins = (process.env.BENCH_CORS_ORIGINS ?? "").trim();
  app.use(
    "*",
    cors({
      origin: corsOrigins
        ? corsOrigins
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : "*",
      allowHeaders: ["Content-Type", "Authorization", "x-api-key"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    }),
  );

  // API 키 인증(opt-in) — CORS 뒤, 핸들러 앞. `/api/*`(및 `/api/v1/*`) 전체를 커버.
  app.use("/api/*", benchApiKeyAuth());

  // 동일 핸들러 세트를 두 prefix에 등록: `/api`(웹 UI 호환) + `/api/v1`(문서화된 안정 표면).
  registerApiRoutes(app, "/api");
  registerApiRoutes(app, "/api/v1");

  return app;
}
