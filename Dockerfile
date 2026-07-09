# syntax=docker/dockerfile:1
# 멀티 스테이지: api(Node) + web(nginx 정적 + /api 프록시)
FROM node:24-bookworm AS build
WORKDIR /app

ARG PNPM_VERSION=11.1.1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/mcp/package.json ./apps/mcp/

RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @llm-bench/server deploy --prod --legacy /out/server
RUN pnpm --filter @llm-bench/mcp deploy --prod --legacy /out/mcp

# --- API (프로덕션 번들 + node:sqlite)
FROM node:24-bookworm-slim AS api
WORKDIR /srv
ENV NODE_ENV=production
ENV PORT=20080
ENV BENCH_DB_PATH=/data/bench.sqlite
COPY --from=build /out/server /srv
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 20080
CMD ["node", "dist/index.js"]

# --- MCP (벤치 API를 프록시하는 streamable-HTTP MCP 서버)
FROM node:24-bookworm-slim AS mcp
WORKDIR /srv
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_HOST=0.0.0.0
ENV MCP_PORT=20090
ENV BENCH_API_URL=http://api:20080
ENV BENCH_API_VERSION=/api/v1
COPY --from=build /out/mcp /srv
EXPOSE 20090
CMD ["node", "dist/index.js"]

# --- UI (동일 오리진 /api → api 서비스)
FROM nginx:1.31-alpine AS web
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
