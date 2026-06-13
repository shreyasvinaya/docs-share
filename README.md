# docs-share

Self-hostable document sharing for teams that want Git-backed uploads, file previews, public links, team access, and an agent-friendly CLI.

The project is a Bun/Turbo monorepo:

- `packages/server` - Hono API, SQLite/Drizzle storage, Git smart HTTP, file extraction, share routes.
- `packages/web` - React/Vite web app.
- `packages/cli` - `docs-share` command-line client.
- `packages/shared` - shared TypeScript types and validation schemas.

New here? Read [`HANDOFF.md`](HANDOFF.md) for the full picture — what the project is, how it's
built, current feature status, gotchas, and the roadmap.

Product docs:

- [`docs/product-guide.md`](docs/product-guide.md) - practical guide for drafts, uploads, teams, sharing, previews, auth, examples, and operations.
- [`docs/agent-guide.md`](docs/agent-guide.md) - CLI/API workflows and source anchors for coding agents.
- [`SKILLS.md`](SKILLS.md) - quick project guide for future coding agents.
- [`docs/self-hosting.md`](docs/self-hosting.md) and [`docs/deployment.md`](docs/deployment.md) - deployment and operations.

## Status

This repository is early-stage open-source software. It is suitable for local development and self-hosting evaluation. For production, review `SECURITY.md`, set strong secrets, use HTTPS, and keep the persistent data volume backed up.

## Quick Start

```bash
bun install
cp .env.example .env
bun run dev
```

The web app runs on `http://localhost:5173` and proxies API traffic to the server on `http://localhost:3000`.

For local dev login, set `ENABLE_DEV_LOGIN=true` in `.env` and sign in with any email plus password `dev`.

## Self-Hosting With Docker

```bash
cp .env.production.example .env.production
# Edit .env.production with your public URL, OAuth credentials, and 32+ char secrets.
docker compose up --build
```

The compose setup runs one app container on port `3000` and stores SQLite, bare Git repositories, and extracted worktrees in the `docs-share-data` volume.

Minimum production settings:

- `NODE_ENV=production`
- `APP_URL=https://your-domain`
- `API_URL=https://your-domain`
- `CONTENT_ORIGIN=https://your-domain`
- `GOOGLE_REDIRECT_URI=https://your-domain/api/auth/google/callback`
- `SESSION_SECRET` and `HOOK_SECRET` with at least 32 random characters

If you terminate TLS at a reverse proxy, forward traffic to the container on port `3000`.

For Render, Fly.io, Railway, VPS, Docker, and Kubernetes notes, see
[`docs/deployment.md`](docs/deployment.md).

## CLI

Build the CLI:

```bash
bun run --filter docs-share build
```

Authenticate with an API token from the web app:

```bash
docs-share login --token ds_...
docs-share draft ./plan.html
docs-share push ./site --to personal --message "Publish site"
docs-share teams
```

Drafts published with `docs-share draft` are visible in the authenticated web
app under **Drafts**, where owners can open, copy, search, and delete their
private draft URLs.

## Linked HTML Bundles

docs-share serves files by their repo-relative path. If `index.html` links to `about.html` or `assets/app.css`, those links resolve when the linked files exist at the matching paths in the same repo tree.

Upload options:

- Website: upload individual files for flat bundles, or choose/drop a folder to preserve nested paths.
- CLI: `docs-share push ./site --to personal` preserves paths under `./site`.
- GitHub sync: configure a public `https://github.com/owner/repo` branch from the file page and sync it into the repo.

For public links, share the containing directory when an HTML page depends on sibling pages or assets. File-only shares expose only that file.

## Development Commands

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bun run check
```

## Backups

Back up the full `DATA_DIR`. It contains:

- `docs-share.db`
- `drafts/`
- `repos/`
- `worktrees/`

Stop writes before taking filesystem-level backups, or use a volume snapshot that is consistent for SQLite WAL files.

## Contributing

See `CONTRIBUTING.md`.

## Security

See `SECURITY.md`.

## License

Apache-2.0. See `LICENSE`.
