# Deployment Guide

This guide covers practical deployment paths for docs-share. The app is a single
Bun server in production: it serves the API, Git endpoints, preview routes, and
the built React app from one process. Persistent data lives in `DATA_DIR`.

## Production Checklist

Before deploying anywhere:

1. Set strong secrets:
   - `SESSION_SECRET`
   - `DRAFT_CONTENT_SECRET`
   - `HOOK_SECRET`
2. Set public URLs:
   - `APP_URL=https://docs.example.com`
   - `API_URL=https://docs.example.com`
   - `CONTENT_ORIGIN=https://content.docs.example.com`
3. Configure Google OAuth:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI=https://docs.example.com/api/auth/google/callback`
4. Disable dev login:
   - `ENABLE_DEV_LOGIN=false`
5. Persist and back up `DATA_DIR`.
6. Put TLS in front of the app.
7. Allow large upload request bodies at the proxy/platform layer.

`CONTENT_ORIGIN` may point to the same host for local testing. In production,
prefer a separate host so sandboxed draft HTML has a clean origin boundary.

## Environment Variables

Minimum production environment:

```bash
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

APP_URL=https://docs.example.com
API_URL=https://docs.example.com
CONTENT_ORIGIN=https://content.docs.example.com
DEPLOYMENT_NAME="Example Docs"
SYSADMIN_EMAILS=admin@example.com
GOOGLE_REDIRECT_URI=https://docs.example.com/api/auth/google/callback

DATA_DIR=/data
WEB_DIST_DIR=/app/packages/web/dist
ENABLE_DEV_LOGIN=false
ALLOW_INSECURE_APP_URL=false

SESSION_SECRET=replace-with-32-plus-random-characters
DRAFT_CONTENT_SECRET=replace-with-different-32-plus-random-characters
HOOK_SECRET=replace-with-another-32-plus-random-characters

GOOGLE_CLIENT_ID=replace-me.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=replace-me

# Optional integrations.
GITHUB_TOKEN_SECRET=replace-with-32-plus-random-characters
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_PRIVATE_KEY=
EMAIL_FROM="docs-share <notifications@docs.example.com>"
RESEND_API_KEY=
SLACK_WEBHOOK_URL=
```

## Docker Compose

Use this for a VPS, local server, homelab, or any host that can run Docker.

```bash
cp .env.production.example .env.production
# Edit .env.production.
docker compose up --build -d
docker compose logs -f
```

The compose file stores data in the `docs-share-data` Docker volume. Back up
that volume or mount `DATA_DIR` to a host path you already back up.

For Caddy:

```caddyfile
docs.example.com {
  reverse_proxy 127.0.0.1:3000
}

content.docs.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

For Nginx:

```nginx
server {
  server_name docs.example.com content.docs.example.com;

  client_max_body_size 100m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

## Render

Recommended shape: one Web Service plus one persistent disk.

1. Create a new Web Service from the GitHub repository.
2. Runtime: Docker.
3. Add a persistent disk mounted at `/data`.
4. Set `DATA_DIR=/data`.
5. Set `WEB_DIST_DIR=/app/packages/web/dist`.
6. Set all production environment variables.
7. Add both domains:
   - `docs.example.com`
   - `content.docs.example.com`
8. Set Google OAuth redirect URI to:
   - `https://docs.example.com/api/auth/google/callback`

Health check path:

```text
/health
```

## Fly.io

Recommended shape: one Fly app plus a volume.

```bash
fly launch --dockerfile Dockerfile --name docs-share
fly volumes create docs_share_data --size 10 --region <region>
fly secrets set \
  NODE_ENV=production \
  APP_URL=https://docs.example.com \
  API_URL=https://docs.example.com \
  CONTENT_ORIGIN=https://content.docs.example.com \
  GOOGLE_REDIRECT_URI=https://docs.example.com/api/auth/google/callback \
  ENABLE_DEV_LOGIN=false \
  SESSION_SECRET=... \
  DRAFT_CONTENT_SECRET=... \
  HOOK_SECRET=... \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=...
```

In `fly.toml`, mount the volume:

```toml
[mounts]
  source = "docs_share_data"
  destination = "/data"

[env]
  PORT = "3000"
  HOST = "0.0.0.0"
  DATA_DIR = "/data"
  WEB_DIST_DIR = "/app/packages/web/dist"
```

Then deploy:

```bash
fly deploy
```

Map both domains to the Fly app if using a separate `CONTENT_ORIGIN`.

## Railway

Recommended shape: Docker deploy plus a persistent volume.

1. Create a Railway project from the GitHub repository.
2. Use the Dockerfile deploy path.
3. Add a volume and mount it at `/data`.
4. Set:
   - `DATA_DIR=/data`
   - `WEB_DIST_DIR=/app/packages/web/dist`
   - `PORT=3000`
5. Set the production secrets and OAuth variables.
6. Add custom domains for app and content origins.
7. Use `/health` as the health check if configured.

Railway may inject its own public URL. Use your stable custom domain for
`APP_URL`, `API_URL`, and Google OAuth.

## VPS Without Docker

Use this when you want to run Bun directly under systemd.

```bash
curl -fsSL https://bun.sh/install | bash
git clone https://github.com/shreyasvinaya/docs-share.git
cd docs-share
bun install --frozen-lockfile
bun run build
```

Create `/etc/docs-share.env` with production variables. Use a persistent data
directory:

```bash
sudo mkdir -p /var/lib/docs-share
sudo chown -R $USER:$USER /var/lib/docs-share
```

Example systemd unit:

```ini
[Unit]
Description=docs-share
After=network.target

[Service]
WorkingDirectory=/opt/docs-share
EnvironmentFile=/etc/docs-share.env
ExecStart=/home/docs-share/.bun/bin/bun run packages/server/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Run a reverse proxy such as Caddy or Nginx in front of port `3000`.

## Kubernetes

Use a single Deployment plus a PersistentVolumeClaim.

Key requirements:

- Mount persistent storage at `/data`.
- Set `DATA_DIR=/data`.
- Expose container port `3000`.
- Route both app and content hostnames to the same Service.
- Configure upload body size on the Ingress.

Minimal container env:

```yaml
env:
  - name: NODE_ENV
    value: production
  - name: PORT
    value: "3000"
  - name: HOST
    value: 0.0.0.0
  - name: DATA_DIR
    value: /data
  - name: WEB_DIST_DIR
    value: /app/packages/web/dist
```

Store secrets in Kubernetes Secrets, not in the Deployment manifest.

## Platforms To Avoid For Now

Avoid purely serverless platforms for the full app until storage is redesigned:

- Vercel serverless functions
- Netlify functions
- Cloudflare Workers
- AWS Lambda without persistent filesystem strategy

docs-share currently expects persistent local filesystem storage for SQLite,
bare Git repositories, extracted worktrees, drafts, and generated Git hooks.

## Backups And Restore

Back up the full `DATA_DIR`, including SQLite WAL files:

- `docs-share.db`
- `docs-share.db-wal`
- `docs-share.db-shm`
- `repos/`
- `worktrees/`
- `drafts/`

For safest backups, pause writes or use platform volume snapshots.

Restore by deploying the same app version or newer, restoring `DATA_DIR`, and
starting the service. Migrations run on server start.

## Smoke Test

After deployment:

```bash
curl -fsS https://docs.example.com/health
```

Then verify:

1. Google login succeeds.
2. Personal files page loads.
3. Upload an HTML file plus CSS.
4. Preview loads the HTML and CSS.
5. Create a team and upload to the team repo.
6. Create an API token and run the CLI against `API_URL`.
7. Publish a draft and open the authenticated draft URL.
