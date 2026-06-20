# Patra

Self-hostable, Git-backed publishing and sharing of documents, static sites, and
HTML drafts as shareable links — with an agent-friendly CLI for non-interactive
publishing.

> **Patra** (ಪತ್ರ / पत्र) is Sanskrit/Kannada for "page," "leaf," or "letter" —
> a fitting name for a place to keep and share your documents.

## What It Is

Patra hosts, versions, previews, and shares self-contained HTML artifacts and
multi-file static sites with real access control. It is built for two audiences:

- **Teams** that want a simpler, HTML-specialized "Drive" with a Git backbone,
  link sharing, team access, and an audit trail.
- **AI coding agents** (Claude Code, Codex, etc.) that generate reports,
  dashboards, mockups, and plans and need to push a file and get back a clean,
  shareable URL — non-interactively, with token auth and deterministic output.

It is a Bun/Turbo monorepo: a Hono API server, a React/Vite web app, a
`docs-share` CLI, and a shared types package.

## Features

- **Draft HTML hosting** — publish a single standalone `.html` file to a private,
  authenticated viewer URL, served through short-lived **signed** content URLs on
  a separate content origin.
- **Git-backed repos + multi-file sites** — every user and team owns one bare Git
  repo; upload folders or push over Git smart-HTTP. Linked pages, CSS, and assets
  resolve by relative path without rewriting.
- **Flexible sharing** — public links, email shares, and team shares, with
  optional **password protection**, **expiry**, and **organization/email-domain
  gating** (`public` vs `org` link access).
- **Analytics + audit log** — per-share and per-draft view metrics (total views,
  unique visitors, last viewed, referrers) plus an actor activity audit log.
- **Versioning** — repos are Git-backed; restore any file (or the whole tree) from
  history as a new commit, and **duplicate** files or drafts.
- **Scoped API tokens** — least-privilege tokens (`repo:*`, `share:*`, `team:*`,
  `draft:*`, `git:*`, `site-data:*`, `webhook:*`, `audit:read`, `user:*`, or `*`)
  enforced on every authenticated endpoint.
- **GitHub sync** — one-way import via a **GitHub App** (selected-repository
  access) or a **personal access token** fallback; pick a whole repo, folder, or
  single file before syncing.
- **Teams** — full team CRUD with `owner` / `admin` / `member` / `viewer` roles
  and email invitations.
- **Form / site-data collection** — opt-in, per-collection form ingestion from
  hosted pages, public and rate-limited, storing only hashed visitor identifiers.
- **Outbound webhooks** — user-configurable, **HMAC-signed** event deliveries
  (`share.created`, `share.revoked`, `github_sync.completed`) with **SSRF guards**
  (private/loopback hosts rejected).
- **First-run setup + admin** — a setup wizard and a sysadmin-only setup checklist;
  sysadmins are derived from `SYSADMIN_EMAILS`.
- **Docs** — a hosted product/agent/API reference, an **OpenAPI 3.1** spec at
  `GET /openapi.json`, and a machine-readable `GET /llms.txt`.
- **Rate limiting** — in-memory fixed-window limiter on public and auth endpoints,
  tunable via env.
- **Docker self-hosting** — single app container, SQLite + Git repos on a volume.

## Quick Start (Local Dev)

```bash
bun install
cp .env.example .env
bun run dev
```

The web app runs on `http://localhost:5173` and proxies API traffic to the server
on `http://localhost:3000`.

For local dev login, set `ENABLE_DEV_LOGIN=true` in `.env`, then sign in with any
email and password `dev`.

## Self-Hosting (Docker)

```bash
cp .env.production.example .env.production
# Edit .env.production: public URLs, OAuth credentials, and 32+ char secrets.
docker compose up --build
```

The compose setup runs one app container on port `3000` and stores SQLite, bare
Git repositories, and extracted worktrees in the persistent data volume.

Minimum production settings:

- `NODE_ENV=production`
- `APP_URL=https://your-domain`
- `API_URL=https://your-domain`
- `CONTENT_ORIGIN=https://content.your-domain` (a separate host for sandboxed
  draft HTML)
- `DEPLOYMENT_NAME="Your Company Docs"` for visible deployment branding
  (defaults to `Patra`)
- `SYSADMIN_EMAILS=admin@your-domain` for setup/admin access
- `GOOGLE_REDIRECT_URI=https://your-domain/api/auth/google/callback`
- `SESSION_SECRET`, `DRAFT_CONTENT_SECRET`, `HOOK_SECRET`, and
  `GITHUB_TOKEN_SECRET` — each a unique 32+ character random value
- `ENABLE_DEV_LOGIN=false`

If you terminate TLS at a reverse proxy, forward traffic to the container on port
`3000`. For full details and platform-specific notes, see
[`docs/self-hosting.md`](docs/self-hosting.md) and
[`docs/deployment.md`](docs/deployment.md).

## CLI

The command-line client is published as the `docs-share` binary. Authenticate
with an API token created in **Settings → API Tokens** (tokens are prefixed
`ds_` and shown once):

```bash
docs-share login --token ds_...
docs-share draft ./plan.html          # publish one HTML file, print its URL
docs-share push ./site --to personal --message "Publish site"
docs-share teams
```

Drafts published with `docs-share draft` appear in the authenticated web app under
**Drafts**, where owners can open, copy, search, and delete their private draft
URLs.

## Project Layout

Bun workspaces + Turborepo monorepo:

- `packages/server` — Hono API, SQLite/Drizzle storage, Git smart-HTTP, file
  extraction, share/draft/webhook routes, OpenAPI + llms.txt.
- `packages/web` — React/Vite/Tailwind web app.
- `packages/cli` — the `docs-share` command-line client.
- `packages/shared` — shared TypeScript types and Zod validation schemas.

## Documentation

- In-app docs are served at `/docs`.
- Markdown sources live in [`docs/`](docs/):
  [Product Guide](docs/product-guide.md),
  [Agent Guide](docs/agent-guide.md),
  [API Reference](docs/api-reference.md),
  [Self-Hosting](docs/self-hosting.md),
  [Deployment](docs/deployment.md).
- New here? [`HANDOFF.md`](HANDOFF.md) explains the architecture, feature status,
  and gotchas.

## Documentation on GitHub Pages

The [`docs/`](docs/) folder is ready to publish as a GitHub Pages site (built with
Jekyll and the `jekyll-theme-cayman` theme configured in
[`docs/_config.yml`](docs/_config.yml); [`docs/index.md`](docs/index.md) is the
landing page). Choose **one** of the two methods below.

### Method 1 — Deploy from a branch (simplest)

1. In the repo, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **"Deploy from a branch"**.
3. Set **Branch** to `main` and **Folder** to `/docs`, then click **Save**.

The site publishes at `https://<user>.github.io/<repo>/`. Because this repository
is named `docs-share`, the URL path reflects the repo name
(`https://<user>.github.io/docs-share/`) until/unless the repo is renamed. Adding
new `docs/*.md` files auto-publishes them on the next push to `main`. The
`title`/`theme` come from `docs/_config.yml`.

### Method 2 — GitHub Actions (more control)

A ready-to-use workflow lives at
[`.github/workflows/docs-pages.yml`](.github/workflows/docs-pages.yml). It builds
`docs/` with the official Jekyll Pages action and deploys on every push to `main`
that touches `docs/**`. To use it, set **Settings → Pages → Source** to **"GitHub
Actions"** instead of the branch method.

Pick exactly one method — they are alternatives, not complementary.

## Security

Patra ships with authentication (Google OAuth sessions + scoped `ds_` API
tokens), sandboxed content serving (untrusted draft HTML runs from a separate
`CONTENT_ORIGIN` behind short-lived signed URLs and a `sandbox` CSP),
SSRF-guarded outbound webhooks, and rate limiting. Operators should set strong,
unique 32+ character secrets and terminate TLS (HTTPS) in front of the app. See
[`SECURITY.md`](SECURITY.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

Apache-2.0. See [`LICENSE`](LICENSE).
