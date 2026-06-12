FROM oven/bun:1.3.8-debian AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/web/package.json packages/web/package.json

RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM base AS app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/data
ENV WEB_DIST_DIR=/app/packages/web/dist

VOLUME ["/data"]
EXPOSE 3000

CMD ["bun", "run", "packages/server/src/index.ts"]
