# Security Policy

## Supported Versions

Security fixes are applied to the current main branch until formal releases begin.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately to the project maintainers. Include:

- Affected version or commit
- Reproduction steps
- Expected and actual behavior
- Impact assessment

Do not publish exploit details until a fix is available.

## Self-Hosting Hardening

Production deployments should:

- Set `NODE_ENV=production`.
- Use HTTPS for `APP_URL`, `API_URL`, `CONTENT_ORIGIN`, and OAuth redirects.
- Set `SESSION_SECRET` and `HOOK_SECRET` to unique random values with at least 32 characters.
- Keep `ENABLE_DEV_LOGIN=false`.
- Back up the complete `DATA_DIR`.
- Restrict direct access to the data volume and database files.
- Run behind a reverse proxy that terminates TLS and preserves `Host` headers.
- Keep dependencies current and run `bun audit`.

## Auth And Access Model

- Web sessions use the `ds_session` cookie.
- API and Git access use API tokens.
- Git smart HTTP enforces token scopes and repo membership.
- Public links can be restricted by password, expiry, and organization domain.

## Known Operational Risks

- SQLite is the default storage engine. It is suitable for small deployments, but larger multi-node enterprise deployments should use a future external database backend.
- Audit logging is intentionally minimal today. Regulated deployments should add durable audit event storage before production use.
