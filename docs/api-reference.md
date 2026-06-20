# API Reference

This is a per-endpoint reference for the docs-share HTTP API. The complete,
machine-readable contract lives at `GET /openapi.json` (OpenAPI 3.1). A concise
agent-oriented summary is served at `GET /llms.txt`.

## Base URL and conventions

- Base URL: your server origin, e.g. `https://docs.example.com` (the examples
  below use `$API`).
- JSON responses wrap their payload in a `{ "data": ... }` envelope. A few
  legacy auth endpoints return `{ "user": ... }` or `{ "tokens": ... }`.
- Errors return `{ "error": "message", "details"?: "..." }` with a 4xx/5xx code.

Set a base URL and token for the examples:

```bash
export API="https://docs.example.com"
export TOKEN="ds_your_api_token_here"
```

## Authentication

Three mechanisms exist:

- **Session cookie** (`ds_session`) — set by Google OAuth, used by the web app.
- **Bearer API token** — `Authorization: Bearer ds_...`, used by the CLI and
  automation. Create one with `POST /api/auth/tokens`.
- **HTTP Basic over git** — for the smart-HTTP transport, use any username and
  your `ds_` token as the password.

API tokens carry **scopes** (space- or comma-separated): `*` (all), `draft:read`,
`draft:write`, `git:read`, `git:write`, `site-data:read`, `site-data:write`,
`webhook:read`, `webhook:write`, or wildcards like `draft:*` / `git:*`.

```bash
curl -s -X POST "$API/api/auth/tokens" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"ci","scopes":"draft:* git:*","expiresIn":2592000}'
```

Response codes: `201` created, `400` missing name, `401` not authenticated.

---

## Auth

### GET /api/auth/google

Begin Google OAuth. Optional `?next=<relative-path>`. Redirects (`302`) to the
Google consent screen.

### GET /api/auth/google/callback

OAuth callback. Sets `ds_session` and redirects (`302`). `400` invalid state.

### POST /api/auth/dev-login

Development-only login (requires `ENABLE_DEV_LOGIN=true`, non-production).

```bash
curl -s -X POST "$API/api/auth/dev-login" \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"dev"}'
```

Codes: `200`, `400` missing fields, `401` invalid credentials, `404` disabled.

### POST /api/auth/logout

Clears the session. Returns `{ "ok": true }`.

### GET /api/auth/session

Returns the current `{ "user": ... }`. Codes: `200`, `401`, `404`.

```bash
curl -s "$API/api/auth/session" -H "Authorization: Bearer $TOKEN"
```

### GET /api/auth/tokens

List your API tokens (masked — no plaintext). Returns `{ "tokens": [...] }`.

### POST /api/auth/tokens

Create a token. Body: `name` (required), `scopes`, `expiresIn` (seconds). The
plaintext token is returned **once**. Codes: `201`, `400`, `401`.

### DELETE /api/auth/tokens/{tokenId}

**Soft-revoke** a token. The row is never hard-deleted — `revokedAt` is stamped so
the record stays for audit/history, and the token is immediately rejected by
authentication. Re-revoking an already-revoked token returns `404`. Codes: `200`,
`401`, `404`.

```bash
curl -s -X DELETE "$API/api/auth/tokens/$TOKEN_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Users

### GET /api/users/me

Current profile plus your personal repo summary. Codes: `200`, `401`, `404`.

```bash
curl -s "$API/api/users/me" -H "Authorization: Bearer $TOKEN"
```

### PATCH /api/users/me

Update `displayName` and/or `designation`. Codes: `200`, `400`, `401`.

```bash
curl -s -X PATCH "$API/api/users/me" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Ada Lovelace","designation":"Engineer"}'
```

### GET /api/users/me/github-app/install

Starts the GitHub App installation flow. Stores a CSRF state cookie and
redirects (`302`) to the GitHub App installation page. Codes: `302`, `503`
(App not configured).

### GET /api/users/me/github-app/callback

GitHub redirects here after installation. Query params: `installation_id`,
`state`, `code`. Verifies the state cookie, exchanges the OAuth code, and
confirms the user has access to the installation. On success redirects (`302`)
to `/settings?tab=integrations`. Codes: `302`, `400` (bad state/params), `403`
(not authorized for installation), `502` (GitHub API error), `503` (OAuth not
configured).

### GET /api/users/me/github-token

Returns the GitHub credential status for the current user.

Response `data` fields:
- `connected` (bool) — whether any GitHub credential (App or PAT) is stored.
- `connectionType` (`"github_app"` | `"pat"` | `null`) — how the credential is stored.
- `configured` (bool) — whether the GitHub App integration is configured on this deployment.
- `updatedAt` (string | null) — ISO-8601 timestamp when the credential was last updated.
- `installationId` (string | null) — GitHub App installation ID (null for PAT connections).
- `accountLogin` (string | null) — GitHub account login for the App installation.
- `accountType` (string | null) — GitHub account type (`"User"` or `"Organization"`).

### PUT /api/users/me/github-token

Store an encrypted GitHub token. Body: `token` (min length 20). Codes: `200`,
`400`, `401`.

```bash
curl -s -X PUT "$API/api/users/me/github-token" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"token":"ghp_xxx..."}'
```

### DELETE /api/users/me/github-token

Remove the stored GitHub token. Codes: `200`, `401`.

---

## Teams

### GET /api/teams

List teams you belong to. Codes: `200`, `401`.

### POST /api/teams

Create a team. Body: `name`, `slug` (`^[a-z0-9-]+$`), optional `description`.
Codes: `201`, `400`, `401`, `409` slug taken.

```bash
curl -s -X POST "$API/api/teams" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Platform","slug":"platform"}'
```

### GET /api/teams/{teamId}

Team details (members only). Codes: `200`, `403`, `404`.

### PATCH /api/teams/{teamId}

Update name/description (owner or admin). Codes: `200`, `400`, `403`.

### DELETE /api/teams/{teamId}

Delete a team (owner only). Codes: `200`, `403`.

### GET /api/teams/{teamId}/members

List members with roles. Codes: `200`, `403`.

### POST /api/teams/{teamId}/members

Invite by email (owner or admin). Body: `email`, optional `role`
(`owner|admin|member|viewer`). Codes: `201`, `400`, `403`, `409`.

```bash
curl -s -X POST "$API/api/teams/$TEAM_ID/members" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"new@example.com","role":"member"}'
```

### PATCH /api/teams/{teamId}/members/{userId}

Change a member's role (owner only). Codes: `200`, `400`, `403`, `404`.

### DELETE /api/teams/{teamId}/members/{userId}

Remove a member (owner/admin, or self-leave). Codes: `200`, `400` (last owner),
`403`, `404`.

### POST /api/teams/invitations/{token}/accept

Accept a pending team invitation by token, converting it into a membership for the
current user. Your authenticated email must match the invitation's email. To avoid
token enumeration, an **unknown token and an email mismatch both return the same
`404`**. Idempotent: re-accepting by the rightful owner returns the existing
membership. Returns `{ "data": { teamId, role, membershipId, alreadyMember } }`.
Codes: `200`, `401`, `404`.

```bash
curl -s -X POST "$API/api/teams/invitations/$INVITE_TOKEN/accept" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Projects

### GET /api/projects

List projects. Optional `?ownerType=user|team&ownerId=<id>`. Codes: `200`,
`403`.

### POST /api/projects

Create a project. Body: `name`, `slug`, `ownerType`, and `ownerTeamId` or
`ownerUserId`. Codes: `201`, `400`, `403`, `409`.

```bash
curl -s -X POST "$API/api/projects" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Handbook","slug":"handbook","ownerType":"team","ownerTeamId":"'"$TEAM_ID"'"}'
```

### GET /api/projects/{projectId}

Project details. Codes: `200`, `404`.

### PATCH /api/projects/{projectId}

Update name/description. Codes: `200`, `400`, `403`, `404`.

### DELETE /api/projects/{projectId}

Delete project metadata (owner only). Codes: `200`, `403`, `404`.

---

## Files

### GET /api/files/{repoId}

List files at the repo root or `?path=<dir>`. Returns `FileNode[]`. Codes:
`200`, `403`.

```bash
curl -s "$API/api/files/$REPO_ID?path=docs" \
  -H "Authorization: Bearer $TOKEN"
```

### GET /api/files/{repoId}/commits

Recent commits. Optional `?path=` and `?limit=`. Codes: `200`, `403`, `404`,
`500`.

### POST /api/files/{repoId}/upload

Upload files (multipart) and commit. Fields: file(s), optional `path`,
`message`, and a JSON `manifest` of relative paths. Codes: `201`, `400`, `403`,
`404`, `500`.

```bash
curl -s -X POST "$API/api/files/$REPO_ID/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "path=reports" \
  -F "message=Add Q3 report" \
  -F "files=@./q3.html"
```

### DELETE /api/files/{repoId}

Delete a path and commit. Requires `?path=`. Codes: `200`, `400`, `403`, `404`,
`500`.

```bash
curl -s -X DELETE "$API/api/files/$REPO_ID?path=reports/q3.html" \
  -H "Authorization: Bearer $TOKEN"
```

### POST /api/files/{repoId}/restore

Restore a path (or the whole tree) to a prior commit. History is never rewritten:
the content at `sha` is checked out over HEAD and committed as a **new** commit.
Body: `sha` (required, `^[0-9a-fA-F]{4,64}$`), optional `path` (omit to restore the
whole tree, which requires a repo-wide write grant). Returns `{ "data": {
commitSha, path, restoredFrom, message } }` (or `message: "Already at this
version"` when nothing changed). Codes: `200`, `400`, `403`, `404`, `500`.

```bash
curl -s -X POST "$API/api/files/$REPO_ID/restore" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sha":"a1b2c3d","path":"reports/q3.html"}'
```

### POST /api/files/{repoId}/copy

Copy a file or directory to a new path and commit. Requires READ on the source
path and WRITE on the destination path. Body: `sourcePath` (required),
`targetPath` (required), optional `targetRepoId` (copy into a different repo).
Returns `{ "data": { commitSha, sourcePath, targetPath, targetRepoId, filesCopied
} }`. Codes: `201`, `400`, `403`, `404`, `409` (no changes), `500`.

```bash
curl -s -X POST "$API/api/files/$REPO_ID/copy" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sourcePath":"reports/q3.html","targetPath":"archive/q3.html"}'
```

---

## Repos — GitHub sync

### GET /api/repos/{repoId}/github-sync

Current sync config (or `null`). Codes: `200`, `403`.

### POST /api/repos/{repoId}/github-sync

Configure and run a sync. Body: `repoUrl`
(`https://github.com/<owner>/<repo>`), optional `branch` (default `main`),
`sourcePath`. Codes: `201`, `400`, `403`, `404`, `502`.

```bash
curl -s -X POST "$API/api/repos/$REPO_ID/github-sync" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/acme/docs","branch":"main","sourcePath":"site"}'
```

### GET /api/repos/{repoId}/github-sync/repositories

List accessible GitHub repos for the stored token. Optional `?ownerLogin=`.
Codes: `200`, `403`, `502`.

### GET /api/repos/{repoId}/github-sync/organizations

List GitHub organizations. Codes: `200`, `403`, `502`.

### GET /api/repos/{repoId}/github-sync/branches

List branches for `?repoUrl=`. Codes: `200`, `400`, `403`, `502`.

### GET /api/repos/{repoId}/github-sync/tree

List the tree for `?repoUrl=&branch=&path=`. Codes: `200`, `400`, `403`, `502`.

---

## Drafts

Drafts publish a single static HTML file to a private authenticated URL.
Token scopes: `draft:read` (GET) and `draft:write` (POST/DELETE).

### GET /api/drafts

List your drafts. Codes: `200`, `401`, `403`.

### POST /api/drafts

Upload a draft (multipart `file`, optional `title`). Returns
`{ "data": { id, url, title, createdAt } }`. Codes: `200`, `400`, `401`, `403`,
`404`.

```bash
curl -s -X POST "$API/api/drafts" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./plan.html" \
  -F "title=Launch plan"
```

### GET /api/drafts/{draftId}

Draft metadata. Codes: `200`, `403`, `404`.

### DELETE /api/drafts/{draftId}

Delete a draft. Codes: `200`, `403`, `404`, `500`.

### POST /api/drafts/{draftId}/duplicate

Duplicate a draft (owner only; `draft:write`). Copies the content into a new draft
titled `"<original title> (copy)"`. Returns `{ "data": { id, url, title, createdAt
} }`. Codes: `201`, `400`, `403`, `404`.

```bash
curl -s -X POST "$API/api/drafts/$DRAFT_ID/duplicate" \
  -H "Authorization: Bearer $TOKEN"
```

### GET /api/drafts/{draftId}/analytics

Owner-only view metrics for the draft (`draft:read`). Deliberately not widened to
sysadmins. Returns a `ViewStats` object — see [Analytics](#analytics). Codes:
`200`, `403`, `404`.

```bash
curl -s "$API/api/drafts/$DRAFT_ID/analytics" \
  -H "Authorization: Bearer $TOKEN"
```

### GET /d/{draftId}

Render the draft viewer shell (requires a session; redirects to `/login`
otherwise).

### GET /draft-content/{draftId}

Serve signed draft HTML. Requires `?exp=` and `?sig=` query params (generated by
the server). Codes: `200`, `403`, `404`.

---

## Shares

### GET /api/shares

List shares you created. Codes: `200`, `401`.

### GET /api/shares/for-resource

Shares for `?repoId=&path=`. Codes: `200`, `400`, `403`.

### GET /api/shares/incoming

Shares where you are a recipient. Codes: `200`, `401`, `404`.

### POST /api/shares

Create a share. Common body fields: `repoId`, optional `path`, and `shareType`
(`email` | `public_link` | `team`).

- `email`: `emails: []`, optional `permission`.
- `public_link`: optional `expiresIn` (`7d`,`12h`,`30m`,`2w`), `password`,
  `linkAccess` (`public`|`org`).
- `team`: `teamId`, optional `permission`.

Codes: `201` (or `200` on update), `400`, `403`, `404`.

```bash
curl -s -X POST "$API/api/shares" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repoId":"'"$REPO_ID"'","shareType":"public_link","expiresIn":"7d"}'
```

### DELETE /api/shares/{shareId}

Revoke a share (creator only). Codes: `200`, `403`, `404`.

### POST /api/shares/{shareId}/accept

Accept an email share addressed to you. Stamps `acceptedAt` on the matching
recipient row and links it to your account. Only matches a recipient whose email
is yours and that is unclaimed (or already claimed by you). Idempotent. Codes:
`200`, `401`, `404` (recipient or user not found).

```bash
curl -s -X POST "$API/api/shares/$SHARE_ID/accept" \
  -H "Authorization: Bearer $TOKEN"
```

### GET /api/shares/{shareId}/analytics

Owner-only view metrics for the share (creator only; not widened to sysadmins).
Returns a `ViewStats` object — see [Analytics](#analytics). Codes: `200`, `403`,
`404`.

```bash
curl -s "$API/api/shares/$SHARE_ID/analytics" \
  -H "Authorization: Bearer $TOKEN"
```

### GET /api/shares/public/{token}

Resolve public share metadata (no auth). For password-protected links, pass the
`X-Share-Password` header. Codes: `200`, `403`, `404`, `410` expired.

```bash
curl -s "$API/api/shares/public/$SHARE_TOKEN" \
  -H "X-Share-Password: hunter2"
```

---

## View (content serving)

### GET /view/public/{token} and /view/public/{token}/{path}

Serve files from a public share link. No auth for `public` links; `org` links
require a signed-in user with a matching email domain. Browser navigations on a
denial redirect (`302`) to the share-gate page. Password-protected links require
`X-Share-Password`. Codes: `200`, `302`, `400`, `401`, `403`, `404`, `410`.

```bash
curl -s "$API/view/public/$SHARE_TOKEN/index.html" \
  -H "X-Share-Password: hunter2"
```

### GET /view/{repoId} and /view/{repoId}/{path}

Serve files from an authorized repo worktree. Requires a session or bearer
token with access. Codes: `200`, `403`, `404`.

---

## Git smart-HTTP

Authenticate with HTTP Basic: any username, password is a `ds_` token with
`git:read` (fetch) or `git:write` (push). `ownerId` is a user id (for user
repos) or a team slug (for team repos).

```bash
git clone "https://x-access-token:$TOKEN@docs.example.com/git/user/$USER_ID"
git clone "https://x-access-token:$TOKEN@docs.example.com/git/team/platform"
```

- `GET /git/{ownerType}/{ownerId}/info/refs?service=git-upload-pack|git-receive-pack`
- `POST /git/{ownerType}/{ownerId}/git-upload-pack`
- `POST /git/{ownerType}/{ownerId}/git-receive-pack`

Codes: `200`, `400` invalid service, `401` auth required, `404` not found.

---

## Analytics

Per-share and per-draft view metrics. Both endpoints are **owner-only** and
deliberately not widened to sysadmins (sysadmins use the [audit log](#audit) for
oversight). Each returns a `ViewStats` object:

- `totalViews` (int) — total recorded views.
- `uniqueVisitors` (int) — distinct hashed visitors.
- `lastViewedAt` (string | null) — ISO-8601 timestamp of the most recent view.
- `recentReferrers` (string[]) — recent referrer values.

- `GET /api/shares/{shareId}/analytics` — creator only. Codes: `200`, `403`, `404`.
- `GET /api/drafts/{draftId}/analytics` — owner only (`draft:read`). Codes: `200`,
  `403`, `404`.

```bash
curl -s "$API/api/shares/$SHARE_ID/analytics" -H "Authorization: Bearer $TOKEN"
# { "data": { "totalViews": 12, "uniqueVisitors": 7,
#   "lastViewedAt": "2026-06-20T10:00:00.000Z", "recentReferrers": [] } }
```

---

## Audit

A log of actor activity. Each `AuditEntry` has: `id`, `actorUserId`, `actorName`,
`actorEmail`, `action`, `targetType`, `targetId`, `metadata` (object | null), and
`createdAt`. Both endpoints accept an optional `?limit=` (1-500, default 100).

### GET /api/audit

Audit entries performed by the current user. Codes: `200`, `401`.

```bash
curl -s "$API/api/audit?limit=50" -H "Authorization: Bearer $TOKEN"
```

### GET /api/audit/all

Every audit entry across the install. **Sysadmin only.** Codes: `200`, `401`,
`403`.

---

## Admin

Sysadmin-only administration. All endpoints require an authenticated sysadmin;
non-sysadmins get `403`. Sysadmin status is recomputed from the `SYSADMIN_EMAILS`
environment variable on every request.

### GET /api/admin/users

List all users with non-sensitive fields only: `id`, `email`, `displayName`,
`role` (`user` | `sysadmin`), `createdAt`. Returns `{ "data": { "users": [...] }
}`. Codes: `200`, `401`, `403`.

```bash
curl -s "$API/api/admin/users" -H "Authorization: Bearer $TOKEN"
```

### PATCH /api/admin/users/{userId}

**Reserved — always returns `400`.** The `sysadmin` role is managed via the
`SYSADMIN_EMAILS` environment variable, not the API: a DB write here would be
silently overwritten on the next request. Manage sysadmins via `SYSADMIN_EMAILS`
instead. Codes: `400`, `401`, `403`.

### GET /api/admin/branding

Read deployment branding (sysadmin view). Returns `{ "data": { "deploymentName":
"..." } }`. Codes: `200`, `401`, `403`.

---

## Site data (forms)

A target — a draft (`draft:<id>`) or a user-owned repo (`repo:<id>`) — can opt
into named **collections** that accept form submissions. Submissions are
**public** (no auth) and rate-limited; managing collections and reading records
requires the owner with the `site-data:read` / `site-data:write` scopes.

### POST /api/sites/{target}/data/{collection}

**Public, unauthenticated** form ingestion, callable cross-origin from a sandboxed
hosted page. CORS is permissive (`Access-Control-Allow-Origin: *`, no credentials,
`POST`/`OPTIONS` only). The request body is a **flat JSON object of 1-50 scalar
fields** (string, number, boolean, or null; field names 1-128 chars; string values
≤ 5000 chars; total payload ≤ 64 KB). The collection must exist **and** be enabled
for the target, otherwise `404`. Rate-limited per-visitor (20/min) and globally
(600/min). Returns `{ "data": { "received": true } }`. Codes: `201`, `400`
(invalid collection name / JSON / field validation), `404` (unknown target or form
not accepting submissions), `429` (rate limited).

```bash
curl -s -X POST "$API/api/sites/draft:$DRAFT_ID/data/contact" \
  -H "Content-Type: application/json" \
  -d '{"email":"visitor@example.com","message":"Hi there","subscribe":true}'
```

### GET /api/sites/{target}/collections

List a target's collections (owner; `site-data:read`). Each item: `id`,
`collection`, `enabled`, `createdAt`, `updatedAt`. Codes: `200`, `401`, `403`
(not the owner), `404`.

### POST /api/sites/{target}/collections

Enable (opt in) a collection (owner; `site-data:write`). Body: `collection`
(required). Idempotent — `201` on first create, `200` when re-enabling an existing
one. Returns `{ "data": { id, collection, enabled } }`. Codes: `200`, `201`,
`400`, `401`, `403`, `404`.

```bash
curl -s -X POST "$API/api/sites/draft:$DRAFT_ID/collections" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"collection":"contact"}'
```

### DELETE /api/sites/{target}/collections/{collection}

Disable a collection so it stops accepting submissions (owner; `site-data:write`).
Existing records are retained. Idempotent. Returns `{ "data": { "disabled": true }
}`. Codes: `200`, `400`, `401`, `403`, `404`.

### GET /api/sites/{target}/records

List submitted records (owner; `site-data:read`). Soft-deleted records are
excluded; optional `?collection=` filter. Each record: `id`, `collection`,
`fields` (the submitted scalar map), `createdAt`. Codes: `200`, `400`, `401`,
`403`, `404`.

### DELETE /api/sites/{target}/records/{recordId}

Soft-delete one record (owner; `site-data:write`). Idempotent. Returns `{ "data":
{ "deleted": true } }`. Codes: `200`, `401`, `403`, `404`.

---

## Webhooks

Outbound, HMAC-signed event deliveries. Event types: `share.created`,
`share.revoked`, `github_sync.completed`. Each delivery POSTs a JSON envelope
`{ event, deliveredAt, data }` and includes an `X-DocsShare-Signature:
sha256=<hex>` header — the HMAC-SHA256 of the raw request body computed with the
webhook's secret. Verify it with a constant-time comparison. The signing secret
(`whsec_...`) is returned **only once, at creation**, and never again.

Scopes: `webhook:read` (list) and `webhook:write` (create/update/delete).

### POST /api/webhooks

Create a webhook. Body: `url` (required, public http(s) URL — private/loopback
hosts are rejected), `events` (required, non-empty array of event types), optional
`active` (default `true`). The response includes the one-time `secret`. Codes:
`201`, `400`, `401`, `403`.

```bash
curl -s -X POST "$API/api/webhooks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/hooks/docs","events":["share.created","share.revoked"]}'
# { "data": { "id":"...", "url":"...", "events":[...], "active":true,
#   "createdAt":"...", "updatedAt":"...", "secret":"whsec_..." } }
```

### GET /api/webhooks

List your webhooks (the secret is **never** returned here). Codes: `200`, `401`,
`403`.

### PATCH /api/webhooks/{webhookId}

Update a webhook (owner only). Body: any of `url`, `events`, `active`. The secret
is never returned or rotated. Codes: `200`, `400`, `401`, `403`, `404`.

### DELETE /api/webhooks/{webhookId}

Delete a webhook (owner only). Returns `{ "data": { "deleted": true } }`. Codes:
`200`, `401`, `403`, `404`.

---

## Setup

### GET /api/setup/branding

Public endpoint — no auth required. Returns the deployment name.

```bash
curl -s "$API/api/setup/branding"
# { "data": { "deploymentName": "Docs Share" } }
```

### GET /api/setup/status

Sysadmin-only. Returns the full deployment setup checklist. Codes: `200`, `401`,
`403`.

```bash
curl -s "$API/api/setup/status" -H "Authorization: Bearer $TOKEN"
```

Response `data` shape: `SetupStatus` — includes `deploymentName`,
`environment` (`production`, `appUrl`, `contentOrigin`, `devLogin`),
`sysadmin`, `authentication.googleOAuth`, `integrations` (`githubApp`,
`githubPatFallback`), and `security.productionSecrets`. Each sub-check has
`configured` (bool), `label`, and `detail` fields.

---

## Meta

- `GET /health` — `{ "ok": true }`.
- `GET /openapi.json` — the OpenAPI 3.1 specification (public).
- `GET /llms.txt` — machine-readable project summary (public).
