/**
 * The selectable API-token scopes.
 *
 * Tokens carry granular scopes (stored per token, default `*`). The server's
 * `requireScope` middleware enforces them for every authenticated router:
 *
 *   - `repo:read|write`        — repos + file content (list, commits, view,
 *                                upload, delete, restore, copy, github-sync)
 *   - `project:read|write`     — project metadata list/get vs create/update/delete
 *   - `share:read|write`       — share list/get vs create/update/delete/accept
 *   - `team:read|write`        — team list/get vs create/update/delete/members
 *   - `user:read|write`        — profile + github-token read vs update
 *   - `admin:read|write`       — sysadmin user/branding/setup read vs mutate
 *   - `audit:read`             — audit log (read-only)
 *   - `draft:read|write`       — draft list/get vs upload/duplicate/delete
 *   - `git:read|write`         — git smart-HTTP fetch vs push
 *   - `site-data:read|write`   — site-data collections read vs write
 *   - `webhook:read|write`     — webhook list vs create/update/delete
 *
 * NOTE: API-token management (create/list/revoke tokens) is SESSION-ONLY and
 * intentionally has NO scope — an API token must never mint or revoke tokens.
 *
 * `*` grants everything; a `<resource>:*` wildcard grants both actions for one
 * resource (e.g. `repo:*`). See `hasScope` in
 * `packages/server/src/middleware/requireScope.ts`.
 */
export const API_TOKEN_SCOPES = [
  "repo:read",
  "repo:write",
  "project:read",
  "project:write",
  "share:read",
  "share:write",
  "team:read",
  "team:write",
  "user:read",
  "user:write",
  "admin:read",
  "admin:write",
  "audit:read",
  "draft:read",
  "draft:write",
  "git:read",
  "git:write",
  "site-data:read",
  "site-data:write",
  "webhook:read",
  "webhook:write",
] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];
