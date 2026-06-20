# Patra Agent Skills

Use this file as the quick project guide for coding agents. It does not replace
repo instructions in `AGENTS.md`; it summarizes how to use and modify the
Patra product safely.

## Project Shape

Patra is a Bun/Turbo monorepo:

- `packages/server`: Hono API, SQLite/Drizzle schema, Git-backed storage,
  preview routes, draft routes, share routes, and auth.
- `packages/web`: React/Vite app for files, teams, preview, sharing, settings,
  and API tokens.
- `packages/cli`: `patra` command-line client for agents and automation.
- `packages/shared`: shared TypeScript types and validation schemas.

Read the [Product Guide](docs/product-guide.md) before changing product
behavior. Read the [Agent Guide](docs/agent-guide.md) before changing CLI,
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
patra login --token pat_...
patra draft ./plan.html
```

Multi-file static bundle:

```bash
patra push ./site --to personal/run-123 --message "Publish run 123"
```

Public folder share:

```bash
patra share personal/run-123 --public
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
- `packages/web/src/components/files/github-sync-panel.tsx`: GitHub repository,
  branch, remote tree picker, and selected path sync UI.
- `packages/server/src/services/githubSync.ts`: GitHub URL/branch/path
  validation, private token clone URL handling, remote tree listing, and
  selected file/folder import.
- `packages/server/src/services/notifications.ts`: Resend email and Slack
  webhook notification adapters used by share routes.

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
