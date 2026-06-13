# docs-share Agent Skills

Use this file as the quick project guide for coding agents. It does not replace
repo instructions in `AGENTS.md`; it summarizes how to use and modify the
docs-share product safely.

## Project Shape

docs-share is a Bun/Turbo monorepo:

- `packages/server`: Hono API, SQLite/Drizzle schema, Git-backed storage,
  preview routes, draft routes, share routes, and auth.
- `packages/web`: React/Vite app for files, teams, preview, sharing, settings,
  and API tokens.
- `packages/cli`: `docs-share` command-line client for agents and automation.
- `packages/shared`: shared TypeScript types and validation schemas.

Read [`docs/product-guide.md`](docs/product-guide.md) before changing product
behavior. Read [`docs/agent-guide.md`](docs/agent-guide.md) before changing CLI,
API, auth, preview, draft, upload, or share behavior.

## Agent Operating Rules

- Prefer documentation-only edits for documentation tasks. Do not touch app
  route/component source unless the task explicitly requires it.
- Use Bun commands, not npm/yarn/pnpm.
- Preserve existing user changes. Check `git status --short` before and after
  edits.
- Keep changes small, scoped, and reversible.
- Update docs when behavior changes.
- Verify before reporting completion.

## Product Workflows To Know

Single-file authenticated draft:

```bash
docs-share login --token ds_...
docs-share draft ./plan.html
```

Multi-file static bundle:

```bash
docs-share push ./site --to personal/run-123 --message "Publish run 123"
```

Public folder share:

```bash
docs-share share personal/run-123 --public
```

Local development:

```bash
bun install
cp .env.example .env
bun run dev
```

With `ENABLE_DEV_LOGIN=true`, use any email and password `dev`.

## Important Source Anchors

- `packages/cli/src/commands/draft.ts`: URL-first single HTML draft command.
- `packages/server/src/routes/drafts.ts`: `POST /api/drafts`, `/d/:draftId`,
  and signed `/draft-content/:draftId` serving.
- `packages/server/src/services/drafts.ts`: draft validation, title extraction,
  shell HTML, CSP headers, and upload size limit.
- `packages/cli/src/commands/push.ts`: multi-file and folder upload behavior.
- `packages/server/src/routes/files.ts`: repository upload/delete and Git commit
  behavior.
- `packages/server/src/routes/view.ts`: authenticated and public preview
  serving.
- `packages/web/src/components/files/file-upload-zone.tsx`: browser upload and
  folder path preservation.
- `packages/web/src/components/files/file-tree.tsx`: replace, update, share, and
  delete UI actions.
- `packages/web/src/components/sharing/share-dialog.tsx`: email/team/link share
  options.

## Verification

Use the smallest check that proves the claim:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

For docs-only changes:

```bash
git diff --check
```

Run markdown or link checking too when the tool is already available locally.
