---
title: Patra Documentation
---

# Patra

**Patra** (ಪತ್ರ / पत्र — Sanskrit/Kannada for "page" or "document") is a
self-hostable, Git-backed app for publishing and sharing documents, static
sites, and HTML drafts as shareable links — with an agent-friendly CLI for
non-interactive publishing.

It is built for teams and AI coding agents that produce self-contained HTML
artifacts (reports, dashboards, mockups, plans) and need to host, version,
preview, and share them with real access control instead of dropping files into
chat.

## Guides

- [Product Guide](product-guide.md) — drafts, uploads, teams, sharing,
  previews, versioning, and day-to-day use.
- [Agent Guide](agent-guide.md) — CLI/API workflows and source anchors for
  coding agents and automation.
- [API Reference](api-reference.md) — per-endpoint HTTP reference. The
  machine-readable contract is served at `GET /openapi.json` (OpenAPI 3.1) and a
  concise summary at `GET /llms.txt`.
- [Self-Hosting](self-hosting.md) — Docker Compose, required production
  settings, OAuth, GitHub sync, reverse proxy, and rate limiting.
- [Deployment](deployment.md) — platform-specific deployment notes (Render,
  Fly.io, Railway, VPS, Docker, Kubernetes).

## Highlights

- Draft HTML hosting with short-lived signed preview URLs.
- Git-backed repositories with multi-file site hosting (links and assets resolve
  by relative path).
- Public / email / team shares with optional password protection, expiry, and
  organization/domain gating.
- Share and draft view analytics plus an audit log.
- Document versioning (restore from history) and duplicate.
- Scoped API tokens for CLI and automation.
- GitHub App + personal-access-token one-way repo sync.
- Teams with roles and email invitations.
- Opt-in form/site-data collection from hosted pages.
- User-configurable outbound webhooks (HMAC-signed, SSRF-guarded).
- First-run setup wizard and sysadmin administration.
- Rate limiting and Docker-based self-hosting.

The command-line client is published as the `docs-share` binary.

> Source on GitHub: this site is built from the [`docs/`](https://github.com/)
> folder of the repository.
