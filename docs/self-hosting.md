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
- `DEPLOYMENT_NAME="Your Company Docs"`
- `SYSADMIN_EMAILS=admin@your-domain`
- `GOOGLE_REDIRECT_URI=https://your-domain/api/auth/google/callback`
- `SESSION_SECRET` with at least 32 random characters
- `DRAFT_CONTENT_SECRET` with at least 32 random characters, distinct from `SESSION_SECRET`
- `HOOK_SECRET` with at least 32 random characters
- `ENABLE_DEV_LOGIN=false`

Use `ALLOW_INSECURE_APP_URL=true` only for local-only testing without TLS.

## Setup Status

Open `/setup` before or after login to review deployment configuration without
exposing secret values. Users whose email appears in `SYSADMIN_EMAILS` also get
a **Setup** tab under **Settings** after signing in.

### Managing sysadmins

`SYSADMIN_EMAILS` (comma-separated) is the single source of truth for the
sysadmin role. The app re-derives each user's role from this variable on every
privileged request, so removing an email **revokes** access immediately and
adding one **grants** it on the next sign-in / request. To change who is a
sysadmin, edit `SYSADMIN_EMAILS` and restart the deployment.

The in-app **Users** admin page is read-only for roles, and the
`PATCH /api/admin/users/:id` endpoint rejects role changes with `400` — the API
will not pretend to grant or revoke sysadmin, because env is authoritative.

## OAuth

Create a Google OAuth web application and add the callback URL:

```text
https://your-domain/api/auth/google/callback
```

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`.

## Persistent Data

`DATA_DIR` stores SQLite data, bare Git repositories, extracted worktrees, and generated hooks. Back up the whole directory or Docker volume.

## GitHub Sync

Users can connect the GitHub App in **Settings -> Integrations**, choose which repositories Patra can access in GitHub, narrow the picker to one organization, or enter another GitHub repository URL from the file page. If the GitHub App is not configured, users can enter a personal access token as a fallback. Repository options are ordered by last updated. Branch options appear after a repository URL is selected, with common branch names prioritized in the picker. Sync imports the selected branch into the same Git-backed repo tree used by uploads, so interlinked HTML pages and assets resolve by relative path without rewriting.

Private repositories work best with a GitHub App configured with read-only **Contents** repository permission. Set the app callback URL to `https://your-domain/api/users/me/github-app/callback`, then configure `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, and `GITHUB_APP_PRIVATE_KEY`. Patra stores the selected installation ID and generates one-hour installation access tokens on demand. If those app settings are empty, users can save a fine-grained personal access token instead; tokens are encrypted at rest with `GITHUB_TOKEN_SECRET`. The web picker can browse the remote tree and select the whole repository, one folder, or one file before sync.

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

#### Trusted-proxy client IP (rate limiting)

The built-in rate limiter keys anonymous traffic on the client IP. Because a
client can forge `X-Forwarded-For`, the app does **not** trust forwarded
headers by default — set `TRUST_PROXY` deliberately:

- **`TRUST_PROXY=false` (default):** all forwarded headers are ignored. The
  limiter keys on the real socket peer address (the proxy's connection). Use
  this only when the app is exposed directly, or when you accept that all
  traffic arriving through the proxy shares one bucket.
- **`TRUST_PROXY=true`:** the client IP is read **only** from `X-Real-IP`,
  which your proxy must set authoritatively from the real socket address.
  Enable this **only** behind a proxy that **overwrites** `X-Real-IP` on every
  request. The app intentionally ignores `X-Forwarded-For` for rate-limit
  keying, since its first hop is client-controlled.

With nginx, overwrite the header from the real peer address and make sure the
proxy does **not** pass through any client-supplied `X-Real-IP` /
`X-Forwarded-For`:

```nginx
# Overwrite, do not append. $remote_addr is the real socket peer.
proxy_set_header X-Real-IP $remote_addr;
```

Then start the app with `TRUST_PROXY=true`. If you cannot guarantee the proxy
overwrites `X-Real-IP`, leave `TRUST_PROXY=false`.

### Custom Domains

Full per-tenant TLS custom-domain automation is intentionally out of scope for
the self-hosted build. Instead, point any custom domain at your reverse proxy
and let the proxy terminate TLS for that hostname. The app itself does not need
to know about the domain beyond the `APP_URL` / `API_URL` / `CONTENT_ORIGIN`
values it was started with.

To serve Patra on `docs.example.com`:

1. Add a DNS `A`/`AAAA` (or `CNAME`) record for `docs.example.com` pointing at
   the host running your reverse proxy.
2. Issue a certificate for the domain. Caddy does this automatically; with
   nginx use Certbot or your platform's ACME integration.
3. Add a virtual host that terminates TLS and proxies all paths to the app
   container, exactly as in the example above.
4. Set `APP_URL=https://docs.example.com`, `API_URL=https://docs.example.com`,
   and update `GOOGLE_REDIRECT_URI` to match, then restart the app.

A minimal Caddy example that handles certificates automatically:

```caddy
docs.example.com {
    reverse_proxy app:3000
}

content.example.com {
    reverse_proxy app:3000
}
```

Use a separate hostname (for example `content.example.com`) for
`CONTENT_ORIGIN` so sandboxed draft HTML is served from a different origin than
the app shell.

### Rate Limiting

The app ships with an in-memory fixed-window rate limiter on the public
share/draft/view endpoints and on the auth/token endpoints. Defaults are
generous; tune them with environment variables:

- `RATE_LIMIT_ENABLED` (default `true`) — set to `false` if your proxy already
  enforces limits.
- `RATE_LIMIT_WINDOW_MS` (default `60000`) — window length in milliseconds.
- `RATE_LIMIT_PUBLIC_MAX` (default `120`) — requests per window for public
  read endpoints.
- `RATE_LIMIT_AUTH_MAX` (default `20`) — requests per window for auth/token
  endpoints.
- `RATE_LIMIT_MAX_ENTRIES` (default `10000`) — hard cap on distinct in-memory
  buckets. Expired buckets are reclaimed automatically; when the cap is
  exceeded the oldest buckets are evicted so the store cannot grow without
  bound under a high-cardinality (e.g. spoofed-IP) request mix.

Malformed numeric values (non-numeric, zero, or negative) fall back to the
documented default rather than disabling the limit.

The limiter keys anonymous traffic on the client IP. See **Trusted-proxy client
IP** above and set `TRUST_PROXY` so the IP is derived from a non-spoofable
source. The limiter is per-process. For horizontally scaled deployments, prefer
a shared limiter at the reverse proxy and set `RATE_LIMIT_ENABLED=false`.

## Upgrades

1. Back up `DATA_DIR`.
2. Pull the new image/source.
3. Run `docker compose up --build`.
4. Check `/health`.
