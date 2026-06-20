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
`draft:write`, `git:read`, `git:write`, or wildcards like `draft:*` / `git:*`.

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

Delete a token. Codes: `200`, `401`, `404`.

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

### GET /api/users/me/github-token

Returns `{ "data": { "connected": bool, "updatedAt": ... } }`.

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

## Internal

### GET /internal/repo

Resolve a repo by owner (used by the CLI). Query: `ownerType`, `ownerId`. Codes:
`200`, `400`, `403`, `404`.

### POST /internal/hooks/post-receive

Git post-receive hook callback. Authenticated with the `X-Hook-Secret` header.
Body: `repoPath`, `ref`, `oldRev`, `newRev`. Codes: `200`, `400`, `403`, `404`.

---

## Meta

- `GET /health` — `{ "ok": true }`.
- `GET /openapi.json` — the OpenAPI 3.1 specification (public).
- `GET /llms.txt` — machine-readable project summary (public).
