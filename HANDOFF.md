# docs-share — Engineering Handoff

_Last updated: 2026-06-12_

This document explains what docs-share is, why it exists, how it's built, and the current
state of every feature. It's meant to get a new engineer productive without reading the
whole tree first.

---

## 1. The Idea

**Problem.** AI coding agents (Claude Code, Codex, etc.) constantly generate self-contained
HTML artifacts — reports, dashboards, design mockups, data visualizations. Today those get
dropped into Slack, where they:

- can't be previewed inline (Slack shows raw HTML or forces a download),
- get buried in channel history,
- have no version history,
- have no real access control.

**Solution.** docs-share is a self-hostable platform for **hosting, previewing, versioning,
and sharing HTML files**, with a workflow optimized for *agents pushing files* rather than
humans clicking upload buttons. Think "a simpler Google Drive, specialized for HTML, with a
git backbone and a non-interactive CLI."

**Design north star:** every decision optimizes for the agent push path — non-interactive
CLI, API-token auth, git-based storage, deterministic output, preview URLs returned on push.

---

## 2. Architecture at a Glance

```
Agent / User
   │  (git push  ·  CLI  ·  web upload)
   ▼
Hono API server (Bun runtime)
   │
   ├── Git Smart HTTP  ──►  bare repo per user / per team   (/data/repos)
   │                              │ post-receive hook
   │                              ▼
   ├── File extractor   ──►  worktree per repo              (/data/worktrees)  ← served content
   │
   ├── SQLite (Drizzle) ──►  metadata: users, teams, shares, files, tokens…  (/data/docs-share.db)
   │
   └── Static SPA (React/Vite build) served in production
```

**Repo model (important).** Teams and users are symmetric "entities," each owning exactly
**one** bare git repo. **Projects are just subfolders** within a repo, not separate repos.
A team is like a Google Group: a named set of users sharing one repo.

```
/data/repos/<repoId>.git        bare repo (push target)
/data/worktrees/<repoId>/       extracted files (what /view serves)
/data/docs-share.db             SQLite metadata
```

---

## 3. Tech Stack

| Layer        | Choice                                  | Notes |
|--------------|-----------------------------------------|-------|
| Runtime      | **Bun**                                 | built-in SQLite, native TS, `Bun.spawn` for git |
| HTTP         | **Hono** v4                             | web-standard, streams git protocol |
| DB           | **SQLite + Drizzle ORM** (`bun:sqlite`) | WAL mode, foreign keys on |
| Frontend     | **React + Vite + Tailwind v4**          | SPA behind auth, class-based dark mode |
| Server state | **TanStack React Query**                | |
| UI state     | **Zustand** (persisted)                 | theme, sidebar, etc. |
| CLI          | **Commander.js**                        | `docs-share` binary |
| Monorepo     | **Bun workspaces + Turborepo**          | shared types package |
| IDs          | CUID2-style via `lib/crypto.ts`         | URL-safe, non-guessable |

Monorepo layout (`packages/*`):
- `shared` — Zod schemas + TS types, the single source of truth shared by all packages.
- `server` — Hono API, Drizzle schema, git infra, file extraction, routes.
- `web` — React SPA.
- `cli` — `docs-share` command-line client.

---

## 4. Data Model (SQLite, `packages/server/src/db/schema.ts`)

- **users** — id, email, displayName, avatarUrl, googleId.
- **teams** — id, name, slug, **description**, ownerId.
- **team_members** — teamId, userId, role (`owner` / `admin` / `member` / `viewer`).
- **projects** — metadata only; maps to a subfolder path within an owner's repo.
- **repos** — one per user, one per team; diskPath, headSha, sizeBytes, lastPushAt.
- **api_tokens** — userId, name, tokenPrefix, **tokenHash** (SHA-256), scopes, expiresAt, revokedAt, lastUsedAt.
- **files** — repoId, path, blobSha, sizeBytes, mimeType. Rebuilt from git on every push.
- **shares** — repoId, path (subfolder/file scope), shareType (`email`/`public_link`/`team`),
  permission, publicToken, **linkAccess** (`public`/`org`), **orgDomain**, passwordHash, teamId, expiresAt.
- **share_recipients** — shareId, email, userId, acceptedAt.
- **github_syncs** — repoId, repoUrl, branch, status, lastCommitSha, lastSyncedAt, error.
- **drafts** — ownerUserId, storagePath, title, sourceFilename, sizeBytes, contentSha256,
  publicToken, expiresAt.
- **sessions** — id, userId, expiresAt.

Migrations live in `packages/server/src/db/migrations/` and run automatically at startup
(see `db/index.ts`). The runner reads `meta/_journal.json`, executes each `.sql`, and
**ignores "already exists" and "duplicate column name" errors** so it's idempotent. When you
add a migration: write the `.sql`, add an entry to `_journal.json`.

---

## 5. Auth Model

Two parallel mechanisms, unified by `requireAuth` middleware:

1. **Web UI — Google OAuth → DB session → HttpOnly cookie (`ds_session`).**
   `sessionMiddleware` runs on every request and *optionally* populates `userId` (it never
   rejects). `requireAuth` enforces presence.
2. **CLI / agents / git — API tokens.** Format `ds_` + random. Stored only as SHA-256 hash;
   shown once at creation. Sent as `Authorization: Bearer ds_…`. Git uses HTTP Basic where
   the password is the token.

**Dev login.** With `ENABLE_DEV_LOGIN=true`, `POST /api/auth/dev-login` lets you sign in with
any email + password `dev`. Ignored in production. This is the main way to test locally
without configuring Google OAuth.

---

## 6. Feature Status

### ✅ Implemented & verified

**Auth & accounts**
- Google OAuth sign-in + callback (`/api/auth/google`, `/google/callback`).
- Dev login fallback for local development.
- Sessions with expiry; logout; `GET /api/auth/session`.
- API token CRUD: create (`POST /api/auth/tokens`), list, **hard-delete** on revoke
  (revoked tokens are removed, not soft-deleted).

**Git & content pipeline**
- Bare repo per user/team; auto-created (`git/repoManager.ts`).
- Git Smart HTTP (`git/smartHttp.ts`) — clone/push via `git-upload-pack`/`git-receive-pack`.
- Post-receive → file extraction to worktree (`services/fileExtractor.ts`) → DB indexing.
- Path-traversal hardening in `lib/security.ts` (`resolveInside`, `normalizeRelativePath`),
  with tests (`security.test.ts`).

**Files**
- List repo files (`GET /api/files/:repoId`), commit history (`/:repoId/commits`).
- Web/API multipart upload (`POST /api/files/:repoId/upload`) — clones, commits, pushes.
- File preview page: sandboxed iframe, version-history sidebar, "open in new tab", Share.
- File serving (`/view/:repoId/*`) with auth + access check; directory requests fall back to
  `index.html`.

**Drafts / Postplan-style HTML plan publishing**
- API-token/session upload (`POST /api/drafts`) for a single `.html`/`.htm` draft.
- CLI command `docs-share draft <plan.html>` publishes one draft and prints the hosted URL.
- Authenticated web listing (`/drafts`) shows owner drafts with search, open, copy URL,
  and delete actions.
- Draft metadata is first-class in SQLite (`drafts` table); content is stored under
  `/data/drafts/_drafts/<draftId>/index.html`, not in generic repo files or shares.
- Authenticated draft wrapper (`/d/:draftId`) renders a thin Postplan-style top bar and a
  sandboxed iframe. The iframe deliberately omits `allow-same-origin`.
- Raw draft content is served through short-lived signed `/draft-content/:draftId?...` URLs
  on `CONTENT_ORIGIN` with a CSP `sandbox allow-scripts` header and no-referrer policy,
  rather than through `/view`. Those content URLs are short-lived bearer URLs signed with
  `DRAFT_CONTENT_SECRET`.
- API-token upload/delete requires `draft:write`, `draft:*`, or `*` scope. API-token list
  and lookup requires `draft:read`, `draft:*`, or `*` scope; browser sessions bypass
  API-token scope checks.

**Teams (Google-Group-style)**
- Full CRUD, **descriptions**, member management with roles, invite by email.
- `/teams` index page (card grid) + per-team overview + settings (incl. danger zone).
- Teams shown on the dashboard and sidebar; breadcrumbs resolve team IDs → names.

**Projects** — metadata CRUD for named subfolders (`/api/projects`).

**Sharing (Google-Drive-style)** — the most-iterated area:
- **Email shares** — specific addresses, read/write permission.
- **Team shares** — all members of a team get access.
- **Public links — two access levels:**
  - `public` — anyone with the link, **no sign-in** (`/view/public/:token/*`).
  - `org` — requires sign-in **and** email-domain match against the creator's domain
    (`orgDomain`). Returns 401 if anonymous, 403 if wrong domain, with descriptive payloads.
- **Links persist** — re-sharing the same repo+path returns the *existing* link instead of
  minting a new token; changing the access level updates in place. Optional password
  (`X-Share-Password` header) and expiry are supported.
- Share dialog auto-opens the **Link** tab when a link already exists for the resource.
- `GET /api/shares/for-resource?repoId&path` powers the dialog's "existing shares" view.
- "Shared with me" page + `GET /api/shares/incoming`.

**GitHub sync** (newer addition)
- `POST /api/repos/:repoId/github-sync` — shallow-clones `github.com/<owner>/<repo>`
  on a given branch, uses the signed-in user's encrypted GitHub token when connected,
  optionally imports one selected file or folder, force-pushes into the entity's bare repo,
  re-extracts + re-indexes.
- `GET /api/repos/:repoId/github-sync` — sync status (`syncing`/`success`/`error` + last commit).
- `GET /api/repos/:repoId/github-sync/tree` — remote tree picker data for selecting one file
  or folder before import.
- URL/branch/path validation in `services/githubSync.ts` (https + github.com only, sanitized branch and import path).

**CLI (`packages/cli`)** — `login`, `push`, `draft`, `ls`, `share`, `teams`, `whoami`.
- `push` collects files (recurses dirs, skips dotfiles), uploads multipart, prints preview
  URLs, and can `--share <email>` / `--share-team <slug>` in one shot. JSON output when piped.
- `draft` uploads a single HTML draft and prints only the hosted URL by default. `--json`
  prints `{ id, url, title, createdAt }`.

**Frontend polish**
- Dark mode (Tailwind v4 class strategy, light/dark/system toggle, persisted).
- Dashboard, sidebar, breadcrumbs, empty/loading states.

**Ops / self-hosting**
- `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.production.example`.
- Production secret enforcement: `SESSION_SECRET`/`HOOK_SECRET` must be ≥32 chars and
  non-default; `APP_URL` must be https in production (`lib/security.ts` + `config.ts`).
- `docs/self-hosting.md`, plus `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE`, CI under `.github/`.

### ⚠️ Known limitations / not done
- **GitHub sync uses per-user tokens** — private repo import uses the signed-in user's
  GitHub token from Settings, encrypted with `GITHUB_TOKEN_SECRET`. Sync remains manual
  (no webhook / scheduled re-sync).
- **No content-origin isolation yet** — content is served from the same origin with a CSP,
  not a separate sandbox subdomain (the plan's `content.*` subdomain is unimplemented).
- **No rate limiting** on auth endpoints.
- **Share password** is hashed with the same `hashToken` (SHA-256, unsalted) used for API
  tokens — fine for link-gating, not a substitute for real password hashing.
- **No automated reconciliation job** between git state and the files index (only push-time).
- Email shares don't send actual emails — recipients must already exist / sign in to see them.

---

## 7. Request Surface (quick reference)

```
Auth     GET  /api/auth/google · /google/callback   POST /dev-login · /logout
         GET  /api/auth/session   POST/GET/DELETE /api/auth/tokens[/:id]
Users    GET/PATCH /api/users/me
Teams    POST/GET /api/teams   GET/PATCH/DELETE /api/teams/:id
         GET/POST /api/teams/:id/members   PATCH/DELETE /api/teams/:id/members/:userId
Projects POST/GET /api/projects   GET/PATCH/DELETE /api/projects/:id
Repos    GET/POST /api/repos/:repoId/github-sync
Files    GET /api/files/:repoId · /:repoId/commits   POST /:repoId/upload
Shares   POST/GET /api/shares   GET /api/shares/for-resource · /incoming
         DELETE /api/shares/:id   GET /api/shares/public/:token
Drafts   POST/GET /api/drafts[/:draftId]   DELETE /api/drafts/:draftId
         GET /d/:draftId
         GET /draft-content/:draftId?exp=...&sig=...
Git      /git/*  (smart HTTP)
View     /view/:repoId/*   /view/public/:token[/*]
Internal /internal/*  (post-receive hook target, HOOK_SECRET-gated)
Health   GET /health
```

Access control on file/repo routes goes through `middleware/shareAccess.ts` (`checkAccess`)
or the inline `userHasAccess`/`checkRepoAccess` helpers. API responses are wrapped in
`{ data: … }`; the web `api-client` auto-unwraps.

---

## 8. Running It

```bash
bun install
cp .env.example .env          # set ENABLE_DEV_LOGIN=true for local
bun run dev                   # turbo: server :3000 + web :5173
```

- Web: http://localhost:5173 (proxies API to :3000).
- Server has **no hot reload** — restart after backend changes.
- Type-check everything: `bun run typecheck`. Full gate: `bun run check`
  (lint + typecheck + test + build).
- Tests exist for `lib/security.ts` and `services/githubSync.ts` (`bun test`).

Self-hosting via Docker is documented in `docs/self-hosting.md` (build the web app, set
`WEB_DIST_DIR` so the server serves the SPA, mount `DATA_DIR` as a volume).

### Key env vars
`PORT`, `HOST`, `APP_URL`, `API_URL`, `DATA_DIR`, `WEB_DIST_DIR`, `ENABLE_DEV_LOGIN`,
`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `SESSION_SECRET`, `DRAFT_CONTENT_SECRET`,
`HOOK_SECRET`, `HOOK_BASE_URL`, `CONTENT_ORIGIN`, `ALLOW_INSECURE_APP_URL`.

---

## 9. Gotchas Worth Knowing

- **Hono subrouter wildcards:** `c.req.param("*")` returns `undefined` when mounted via
  `app.route()`. Always parse `c.req.path` against the known prefix instead — this bit the
  `/view` routes hard. `c.req.path` includes the mount prefix.
- **Public share path resolution:** the share stores a `path`; the URL may also carry a
  sub-path. `joinSharePath` + `resolveInside` combine them safely. A file-level share resolves
  with an empty trailing path — don't double-join.
- **Migrations are forgiving by design:** the runner swallows "already exists" / "duplicate
  column name". If a migration silently no-ops, check `_journal.json` has the entry.
- **Draft HTML is untrusted content:** keep `/d/:draftId` as the authenticated wrapper and
  keep raw HTML behind signed `CONTENT_ORIGIN` `/draft-content` URLs with CSP sandboxing.
  Do not point draft iframes at `/view`, and do not add `allow-same-origin` to the draft
  iframe sandbox. Treat signed content URLs as short-lived bearer URLs.
- **Session vs token:** `sessionMiddleware` never 401s; it just *maybe* sets `userId`. That's
  what lets `org` public links check "is the viewer signed in?" without forcing auth on the
  route. Enforcement is `requireAuth` only.
- **One repo per entity:** if you're tempted to make a repo per project, don't — projects are
  subfolders. The whole permission/share model assumes repo = user-or-team.

---

## 10. Where to Look First

| You want to…                        | Start in |
|-------------------------------------|----------|
| Understand routing/wiring           | `packages/server/src/index.ts` |
| Change the data model               | `packages/server/src/db/schema.ts` (+ a migration) |
| Touch sharing logic                 | `routes/shares.ts`, `routes/view.ts`, `components/sharing/share-dialog.tsx` |
| Touch git/upload pipeline           | `git/smartHttp.ts`, `services/fileExtractor.ts`, `routes/files.ts` |
| Add a CLI command                   | `packages/cli/src/commands/` + `index.ts` |
| Add/adjust a shared type            | `packages/shared/src/types/` (rebuild: `bun run build:shared`) |
| Security helpers / path safety      | `packages/server/src/lib/security.ts` |

---

## 11. Roadmap / Suggested Next Steps

Roughly ordered by value-to-effort. None are started.

**Sharing & access**
- Send real invitation emails for email shares (today recipients only see them after they
  sign in). Wire an email provider behind `services/`.
- Salt + slow-hash share passwords (move off the unsalted SHA-256 `hashToken`); consider
  per-link rate limiting on password attempts.
- Expiry UX: surface "expires in N days" in the share dialog and a way to extend/clear it.

**Content safety**
- Serve user HTML from a separate **content origin** (e.g. `content.<domain>`) so a malicious
  upload can't touch app cookies/session — the original plan's isolation goal. Tighten CSP
  once isolated.

**GitHub sync**
- Consider a GitHub App install flow if per-user/private-org authorization is needed.
- **Automatic re-sync**: webhook endpoint + a scheduled fallback poll; show last-sync drift.

**Reliability / ops**
- Background **reconciliation job** that rebuilds the files index from git (catch drift if a
  push hook fails midway).
- **Rate limiting** on auth + dev-login + public-link endpoints.
- Structured request logging + basic metrics; health check that verifies DB + disk.

**Product**
- Search across files/repos.
- Richer preview (raw/source toggle, asset list, copy-link affordances on every row).
- Per-project access control surfaced in the UI (the data model already scopes shares by path).
- Audit log of share creation/revocation and access events.

**Testing**
- Integration tests for the push → extract → index → serve loop and for the share access
  matrix (public vs org vs email vs team, anonymous vs wrong-domain vs right-domain).
```
