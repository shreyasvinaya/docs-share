# Contributing

Thanks for helping improve docs-share.

## Requirements

- Bun `1.3.8`
- Git
- A Google OAuth client for end-to-end auth testing, or `ENABLE_DEV_LOGIN=true` for local-only development

## Setup

```bash
bun install
cp .env.example .env
bun run dev
```

## Checks

Run these before opening a pull request:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

`bun run check` runs the same validation sequence.

## Code Guidelines

- Keep changes small and scoped.
- Add Bun tests for security-sensitive behavior and public API changes.
- Do not commit runtime data, `.env` files, database files, generated worktrees, or Turbo caches.
- Prefer existing package boundaries: server, web, cli, shared.

## Database Changes

Schema changes live in `packages/server/src/db/schema.ts` and migrations live in `packages/server/src/db/migrations`.

Generate migrations from the server package:

```bash
bun run --cwd packages/server db:generate
```

## Security Fixes

Do not open public issues for active vulnerabilities. Follow `SECURITY.md`.
