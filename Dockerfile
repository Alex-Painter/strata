# syntax=docker/dockerfile:1
# One image for the whole app: the Hono server serves the API and the built
# web app. On Railway, mount a volume at /data (SQLite and the git cache).

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo

# Install first, from manifests only, so code changes reuse this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/engine/package.json packages/engine/
COPY apps/cli/package.json apps/cli/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @strata/web build && pnpm --filter @strata/server build
# The bundle inlines everything except native modules; deploy gives the
# server's production node_modules (better-sqlite3) without the workspace.
RUN pnpm deploy --legacy --filter @strata/server --prod /out/server \
  && cp -r apps/server/dist apps/server/drizzle /out/server/ \
  && mkdir -p /out/web \
  && cp -r apps/web/dist /out/web/dist

FROM node:22-bookworm-slim
# git: milestone 1 clones and diffs repositories at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
  DATA_DIR=/data \
  PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "server/dist/main.js"]
