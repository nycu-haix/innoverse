# syntax=docker/dockerfile:1.7
# App image: compiled React frontend + Fastify backend + Codex CLI.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install -g pnpm@12.8.1 && npm cache clean --force
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
COPY apps/server apps/server
RUN pnpm --filter @innoverse/web --filter @innoverse/server run build
# Production-only server package (the shared workspace package is bundled into dist).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter @innoverse/server deploy --prod --legacy /out

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG CODEX_VERSION=0.159.2
RUN npm install -g @openai/codex@${CODEX_VERSION} && npm cache clean --force \
	&& apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	DATABASE_PATH=/data/app/interview.db \
	AUDIO_DIR=/data/app/audio \
	CODEX_HOME=/data/codex \
	CODEX_RUNTIME_DIR=/data/app/codex-workdir \
	WEB_DIST_DIR=/app/web \
	TRUST_PROXY=true
WORKDIR /app
COPY --from=build /out /app/server
COPY --from=build /repo/apps/web/dist /app/web
# Volume mount points owned by the unprivileged user (named volumes inherit this).
RUN mkdir -p /data/app/codex-workdir /data/app/audio /data/codex && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server/dist/index.js"]
