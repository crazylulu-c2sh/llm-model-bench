# syntax=docker/dockerfile:1
# 멀티 스테이지: api(Node) + web(nginx 정적 + /api 프록시)
FROM node:20-bookworm AS build
WORKDIR /app

ARG PNPM_VERSION=10.26.0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @llm-bench/server deploy --prod --legacy /out/server

# --- API (프로덕션 번들 + better-sqlite3)
FROM node:20-bookworm-slim AS api
WORKDIR /srv
ENV NODE_ENV=production
ENV PORT=20080
ENV BENCH_DB_PATH=/data/bench.sqlite
COPY --from=build /out/server /srv
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 20080
CMD ["node", "dist/index.js"]

# --- UI (동일 오리진 /api → api 서비스)
FROM nginx:1.27-alpine AS web
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
