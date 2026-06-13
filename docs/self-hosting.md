# Self-Hosting

For platform-specific deployment paths, see the [Deployment Guide](deployment.md).

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
- `CONTENT_ORIGIN=https://content.your-domain` for sandboxed draft HTML content
- `GOOGLE_REDIRECT_URI=https://your-domain/api/auth/google/callback`
- `SESSION_SECRET` with at least 32 random characters
- `DRAFT_CONTENT_SECRET` with at least 32 random characters, distinct from `SESSION_SECRET`
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

Users can choose from GitHub repositories accessible to their connected token, narrow the picker to one organization, or enter another GitHub repository URL from the file page. Repository options are ordered by last updated. Branch options appear after a repository URL is selected, with common branch names prioritized in the picker. Sync imports the selected branch into the same Git-backed repo tree used by uploads, so interlinked HTML pages and assets resolve by relative path without rewriting.

Private repositories require each user to connect a GitHub token in **Settings -> Integrations**. Use a fine-scoped token with read access to the repositories that user wants docs-share to import. Tokens are encrypted at rest with `GITHUB_TOKEN_SECRET`. The web picker can browse the remote tree and select the whole repository, one folder, or one file before sync.

## Reverse Proxy

Terminate TLS at your proxy and forward all paths to the app container:

- `/`
- `/api`
- `/git`
- `/internal`
- `/view`
- `/draft-content` on `CONTENT_ORIGIN`; for local-only installs this can point at the same
  app, but production should use a separate content host.

Make sure large request bodies are allowed if users upload large files.

## Upgrades

1. Back up `DATA_DIR`.
2. Pull the new image/source.
3. Run `docker compose up --build`.
4. Check `/health`.
