# Security Policy

## Supported Versions

Security fixes are applied to the current `main` branch until formal releases begin.

## Reporting a Vulnerability

Please report suspected vulnerabilities **privately** to the project maintainers. Include:

- Affected version or commit
- Reproduction steps
- Expected and actual behavior
- Impact assessment

Do not publish exploit details until a fix is available.

## Self-Hosting Hardening

Production deployments should:

- Set `NODE_ENV=production` (the server refuses to boot with default/weak secrets in production).
- Use HTTPS for `APP_URL`, `API_URL`, `CONTENT_ORIGIN`, and the OAuth redirect URI.
- Set **all** secrets to unique random values of at least 32 characters: `SESSION_SECRET`, `DRAFT_CONTENT_SECRET`, `HOOK_SECRET`, and `GITHUB_TOKEN_SECRET`. Default/example values are rejected at startup in production.
- Keep `ENABLE_DEV_LOGIN=false` (the username/password dev login is force-disabled in production regardless).
- Set `SYSADMIN_EMAILS` only to addresses on a domain you control. Sysadmin is granted solely from this list (and only to Google accounts with a verified email); removing an address revokes access on the user's next request.
- Set `TRUST_PROXY=true` **only** behind a reverse proxy that overwrites `X-Real-IP` with the real socket address (e.g. nginx `proxy_set_header X-Real-IP $remote_addr;`) and does not pass through client-supplied forwarding headers. When `false`, forwarding headers are ignored and the socket address is used. This keeps rate limiting and analytics from being spoofed.
- To connect a GitHub App, set `GITHUB_APP_CLIENT_ID`/`GITHUB_APP_CLIENT_SECRET` (installation ownership is verified via GitHub's user-to-server OAuth; without them the GitHub-App connect flow fails closed and the PAT fallback remains).
- Run behind a reverse proxy that terminates TLS and preserves `Host` headers.
- Back up the complete `DATA_DIR`; restrict direct access to the data volume and database files.
- Keep dependencies current and run `bun audit`.
- Tune the rate limiter (`RATE_LIMIT_*`) for your environment, or disable it and rate-limit at the proxy in horizontally-scaled deployments (it is per-process in-memory).

## Auth and Access Model

- **Sessions:** web sessions use the `ds_session` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS); expiry is enforced server-side.
- **API tokens:** bearer tokens (`pat_` prefix; older `ds_`-prefixed tokens remain valid) are hashed at rest and carry **scopes** (`repo:*`, `share:*`, `team:*`, `draft:*`, `git:*`, `site-data:*`, `webhook:*`, `user:*`, `audit:read`, or `*`). Scopes are enforced on **every** authenticated route. Token creation/listing/revocation is **session-only** (a token cannot mint another token). Revocation is a soft-revoke (`revokedAt`) checked on every request.
- **Repo/file access:** owners and team members (by role: `owner`/`admin`/`member`/`viewer`) plus **path-scoped** email/team shares. A share scoped to a sub-path cannot read, write, list, or sync outside that path; whole-repo operations require owner/team or a whole-repo share.
- **Shares:** public links support **password protection** (salted scrypt), **expiry**, and **organization/email-domain gating**. Only a share's creator can reconfigure it, and loosening access rotates the public token. Password/org-gated content is served `Cache-Control: private, no-store`.
- **Git smart-HTTP:** Basic-auth with `git:*` token scopes and repo membership; the post-receive hook authenticates with `HOOK_SECRET` via a constant-time comparison.

## Content and Network Security

- **Untrusted content is sandboxed:** uploaded/served HTML and SVG run under a `sandbox` CSP in an opaque origin with `connect-src 'none'`, so a malicious document cannot read the session cookie, reach `window.parent`, or call the API. Drafts are served the same way.
- **Path traversal / symlinks:** request paths are normalized (no `..`, control chars, `.git`, or pathspec magic; git invoked with `GIT_LITERAL_PATHSPECS`), and worktree files are served only after a realpath check confirms they stay inside the repo; GitHub imports strip symlinks.
- **SSRF:** outbound webhooks resolve DNS and reject any private/loopback/link-local/CGNAT/IPv4-mapped address, then **pin the connection to the validated IP** (defeating DNS rebinding). Deliveries are HMAC-signed (`X-Patra-Signature`), reject redirects, and require HTTPS in production. GitHub URLs are strictly normalized.
- **Resource limits:** request body-size limits, git subprocess timeouts (process-group kills), GitHub import blob/size caps, and bounded in-memory limiters guard against memory/disk exhaustion.
- **Secrets:** GitHub tokens are encrypted at rest; secrets and internal filesystem paths are redacted from error responses and logs.

## Operational Notes

- **Audit log:** share create/update/revoke and access events are recorded; owners can view their own entries and sysadmins can view all (`/api/audit`).
- **Retention:** view-event, audit-log, and webhook-delivery tables have scheduled cleanup jobs to bound growth.
- The codebase has undergone repeated adversarial security review; see the PR history for specifics.

## Known Operational Risks

- SQLite is the default storage engine — suitable for small/single-node deployments; large multi-node deployments would need an external database backend.
- The rate limiter and per-repo sync lock are per-process (single-process assumption); horizontally-scaled deployments should enforce limits at the proxy and avoid concurrent writers to the same repo across instances.
