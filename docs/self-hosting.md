# Self-Hosting

## Docker Compose

```bash
cp .env.production.example .env.production
docker compose up --build
```

The app listens on port `3000`. The container serves both the API and the built web app when `WEB_DIST_DIR` is set.

## Required Production Settings

- `NODE_ENV=production`
- `APP_URL=https://your-domain`
- `API_URL=https://your-domain`
- `CONTENT_ORIGIN=https://your-domain`
- `GOOGLE_REDIRECT_URI=https://your-domain/api/auth/google/callback`
- `SESSION_SECRET` with at least 32 random characters
- `HOOK_SECRET` with at least 32 random characters
- `ENABLE_DEV_LOGIN=false`

Use `ALLOW_INSECURE_APP_URL=true` only for local-only testing without TLS.

## OAuth

Create a Google OAuth web application and add the callback URL:

```text
https://your-domain/api/auth/google/callback
```

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`.

## Persistent Data

`DATA_DIR` stores SQLite data, bare Git repositories, extracted worktrees, and generated hooks. Back up the whole directory or Docker volume.

## GitHub Sync

Users can configure a public GitHub repository and branch from the file page. Sync imports the branch into the same Git-backed repo tree used by uploads, so interlinked HTML pages and assets resolve by relative path without rewriting.

Only public `https://github.com/owner/repo` URLs are supported in the initial implementation.

## Reverse Proxy

Terminate TLS at your proxy and forward all paths to the app container:

- `/`
- `/api`
- `/git`
- `/internal`
- `/view`

Make sure large request bodies are allowed if users upload large files.

## Upgrades

1. Back up `DATA_DIR`.
2. Pull the new image/source.
3. Run `docker compose up --build`.
4. Check `/health`.
