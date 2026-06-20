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

# Run as a dedicated non-root user. Create the data dir up front and hand both
# the app tree and DATA_DIR to that user so the server can read its build and
# read/write the SQLite DB + repo storage without root. The volume inherits the
# /data ownership set here.
RUN addgroup --system --gid 1001 docsshare \
  && adduser --system --uid 1001 --ingroup docsshare docsshare \
  && mkdir -p /data \
  && chown -R docsshare:docsshare /app /data

VOLUME ["/data"]
EXPOSE 3000

USER docsshare

CMD ["bun", "run", "packages/server/src/index.ts"]
