# Agent Guide

This guide is for coding agents and automation that need to use docs-share or
modify it safely. For product behavior, read the [Product Guide](product-guide.md).

## Fast Path For Publishing Agent HTML

Use `docs-share draft` when you have exactly one static HTML file and need to
return a private authenticated URL.

```bash
docs-share login --token ds_...
docs-share draft ./plan.html
```

Default output is intentionally URL-only. This is the best shape for agent
handoffs:

```text
https://docs.example.com/d/<draft-id>
```

Use JSON for machine consumption:

```bash
docs-share draft ./plan.html --json
```

Expected JSON fields:

```json
{
  "id": "<draft-id>",
  "url": "https://docs.example.com/d/<draft-id>",
  "title": "Plan title",
  "createdAt": "2026-06-13T00:00:00.000Z"
}
```

Use `--title` when the generated HTML title is generic:

```bash
docs-share draft ./plan.html --title "Checkout Refactor Plan"
```

## When Not To Use Drafts

Do not use `docs-share draft` for multi-file output. It accepts one `.html` or
`.htm` file only.

Use `docs-share push` instead when the output includes:

- External CSS files.
- Linked pages.
- Images, fonts, JavaScript, JSON, or other assets.
- A folder that should be shared publicly.
- Team-owned files.

Example:

```bash
docs-share push ./site --to personal/agent-output --message "Publish agent output"
```

## CLI Commands Agents Commonly Need

Build the CLI after source changes:

```bash
bun run --filter docs-share build
```

Authenticate:

```bash
docs-share login --token ds_...
docs-share whoami
```

Publish one private draft:

```bash
docs-share draft ./report.html
```

Publish a folder and preserve relative paths:

```bash
docs-share push ./site --to personal/run-123 --message "Publish run 123"
```

Share a repository file or folder:

```bash
docs-share share personal/run-123 --public
docs-share share personal/run-123 --with reviewer@example.com
docs-share share personal/run-123 --with reviewer@example.com --write
```

List useful context:

```bash
docs-share ls personal
docs-share ls --teams
docs-share ls --shared
docs-share teams
```

## API Surfaces

Draft upload:

```text
POST /api/drafts
```

Multipart fields:

- `file`: required `.html` or `.htm` file.
- `title`: optional title override, trimmed to 160 characters.

Auth:

- Cookie session, or
- Bearer API token with `*`, `draft:*`, or `draft:write`.

Response:

```json
{
  "data": {
    "id": "<draft-id>",
    "url": "https://docs.example.com/d/<draft-id>",
    "title": "Plan title",
    "createdAt": "2026-06-13T00:00:00.000Z"
  }
}
```

Draft lookup:

```text
GET /api/drafts/:draftId
```

Draft listing:

```text
GET /api/drafts
```

Returns owner drafts sorted newest first. API-token callers need `*`,
`draft:*`, or `draft:read`.

Draft deletion:

```text
DELETE /api/drafts/:draftId
```

Deletes the owner draft metadata and stored HTML. API-token callers need `*`,
`draft:*`, or `draft:write`.

Draft viewer:

```text
GET /d/:draftId
```

Draft content:

```text
GET /draft-content/:draftId?exp=<ms>&sig=<hmac>
```

Do not construct draft content URLs yourself. The viewer generates short-lived
signed URLs.

Repository upload:

```text
POST /api/files/:repoId/upload
```

Multipart fields:

- `file`: one or more files.
- `manifest`: optional JSON array of repo-relative paths, same length and order
  as the uploaded files.
- `path`: optional target subfolder.
- `message`: optional Git commit message.

Repository delete:

```text
DELETE /api/files/:repoId?path=<repo-relative-path>
```

Preview:

```text
GET /view/:repoId/<path>
GET /view/public/:token/<path>
```

## Source Map

Use these files as the current anchors for behavior:

- CLI entrypoint: `packages/cli/src/index.ts`
- Draft CLI command: `packages/cli/src/commands/draft.ts`
- Draft CLI validation/output helpers:
  `packages/cli/src/commands/draft-helpers.ts`
- Push CLI command: `packages/cli/src/commands/push.ts`
- Share CLI command: `packages/cli/src/commands/share.ts`
- Draft API and viewer: `packages/server/src/routes/drafts.ts`
- Draft validation and shell HTML: `packages/server/src/services/drafts.ts`
- File upload/delete API: `packages/server/src/routes/files.ts`
- Preview routes: `packages/server/src/routes/view.ts`
- API token scopes: `packages/server/src/middleware/requireScope.ts`
- Web upload zone: `packages/web/src/components/files/file-upload-zone.tsx`
- Web file tree actions: `packages/web/src/components/files/file-tree.tsx`
- Web preview page: `packages/web/src/pages/file-preview.tsx`
- Web token settings: `packages/web/src/pages/settings.tsx`
- Sample single-file draft: `examples/standalone-draft.html`
- Sample linked bundle: `examples/linked-draft/`

## Constraints To Preserve

- Keep draft publishing single-file and URL-first unless the product
  requirements change.
- Keep private drafts owner-only. Sharing currently belongs to repository files
  and directories, not draft records.
- Keep `CONTENT_ORIGIN` separate from `APP_URL` in production guidance.
- Preserve relative paths for folder uploads. Linked HTML bundles depend on this.
- Treat repository uploads and deletes as Git commits.
- Do not expose plaintext API tokens after creation.
- Do not broaden token scopes casually. `draft:write` is enough for draft upload.
- Do not serve draft content without a valid short-lived signature.

## Local Development Loop

Start the app:

```bash
bun install
cp .env.example .env
bun run dev
```

Default local URLs:

- Web app: `http://localhost:5173`
- Server/API: `http://localhost:3000`

With `ENABLE_DEV_LOGIN=true`, sign in using any email and password `dev`.

Useful checks:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bun run check
```

For documentation-only changes, at minimum run:

```bash
git diff --check
```

Also run a markdown/link sanity check if a local markdown tool is available.

## Common Failure Modes

- `Draft uploads must be .html or .htm files`: use a single HTML file or switch
  to `docs-share push` for a folder.
- `Draft upload exceeds the 10 MB limit`: reduce or split the file. Linked asset
  bundles should use repository upload instead.
- `Token scope does not allow this action`: token scopes are enforced on every
  authenticated endpoint. Create a token with the scope the operation needs —
  e.g. `draft:read`/`draft:write` for drafts, `repo:read`/`repo:write` for repo
  files and content, `share:*`, `team:*`, `user:*`, `audit:read`, `git:*` for
  smart-HTTP — or `*` for full access. `<resource>:*` grants both read and write
  for one resource.
- Relative CSS or page links fail from a public file share: share the containing
  directory instead of the single HTML file.
- `/draft-content/...` returns 403: signed content URLs expire after a short TTL;
  reload the `/d/:draftId` wrapper.
- Dev login returns 404: set `ENABLE_DEV_LOGIN=true` locally and do not run with
  production settings.
