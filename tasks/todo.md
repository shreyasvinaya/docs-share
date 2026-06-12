# Authenticated HTML Draft Publishing Plan

Date: 2026-06-13

## Target Result

Build a Postplan-shaped mode for this repo: agents can upload a single static HTML draft with an API token, receive one clean URL immediately, and humans or other agents can open that URL in a minimal authenticated draft viewer.

## Video-Derived Notes

- The video segment around 16:35-18:09 frames the product as a small private/team service for hosting agent-generated HTML plan files.
- Primary value: agents output a clickable URL so the user can inspect what the agent was thinking or planning.
- Secondary value: agent-to-agent handoff. One agent can review another agent's work, publish HTML, and another agent can consume the URL as context.
- The shown viewer is intentionally minimal: a thin dark top bar saying "Postplan" and "This is a hosted draft.", then the HTML document itself.
- The shown plans are dense, readable HTML documents with large headings, compact summaries, tables, status pills, and high-contrast dark styling.

## Current Repo Anchors

- `packages/cli/src/commands/push.ts` already collects files, uploads multipart data, and prints preview URLs.
- `packages/server/src/routes/files.ts` already accepts authenticated multipart uploads, commits them into git-backed storage, extracts files, and indexes metadata.
- `packages/server/src/routes/view.ts` already serves authenticated `/view/:repoId/*` files and public link files with basic security headers.
- `packages/server/src/middleware/requireAuth.ts` already supports both cookie sessions and bearer API tokens.
- `packages/web/src/pages/file-preview.tsx` already has a full preview UI with iframe, share, and history controls, but it is heavier than the Postplan-style draft URL.

## Product Shape

- Keep docs-share as the richer storage/share platform.
- Add a thin "drafts" lane optimized for one command: upload HTML, return URL.
- Draft URLs should be short and stable, such as `/d/:draftId` for authenticated access and optionally `/p/:publicToken` for explicitly public drafts.
- The default draft viewer should not show the full app shell. It should show only a narrow product bar and the rendered HTML.
- Preserve the raw uploaded HTML as authored by the agent. Do not rewrite its body unless a future sanitization mode is added.

## Proposed Implementation

- Add a `drafts` table with `id`, `owner_user_id`, optional `repo_id`, `path`, `title`, `source_filename`, `size_bytes`, `content_sha256`, optional `public_token`, `expires_at`, `created_at`, and `updated_at`.
- Implement `POST /api/drafts` for bearer-token and session-authenticated upload of one `.html` file.
- Store the file using the existing git-backed upload/extraction path when practical, under a reserved path like `_drafts/<draftId>/index.html`.
- Return `{ id, url, viewUrl, rawUrl, title, createdAt }` from `POST /api/drafts`.
- Implement `GET /d/:draftId` as the minimal authenticated draft wrapper.
- Implement `GET /draft-content/:draftId` or reuse `/view/:repoId/_drafts/:draftId/index.html` for iframe content.
- Add a CLI command, likely `docs-share draft <file>` or a separate alias package later, that uploads one HTML file and prints only the URL by default for agent ergonomics.
- Add JSON output with `--json`, title override with `--title`, expiry with `--expires`, and optional public URL creation with `--public`.
- Add a lightweight web list at `/drafts` later, but do not block the MVP on dashboard management.

## Visual Direction

- Minimal bar: dark navy or near-black, 24-32px tall, small `Postplan` or configured product name on the left, muted "This is a hosted draft." text beside it.
- Viewer body: iframe takes the full remaining viewport; no file tree, sidebar, history panel, or share dialog on the default draft route.
- App dashboard, if added, should remain quiet and utility-focused: searchable draft table with title, created time, URL copy action, visibility, and delete.
- Do not force a house style on the uploaded document, but provide an optional starter HTML template for agents that matches the video: dark background, large heading, summary paragraph, callout blocks, tables, and colored status pills.

## Acceptance Criteria

- Given a valid API token, `docs-share draft plan.html` uploads one HTML file and prints one clickable URL.
- Opening the URL while signed in renders the uploaded HTML inside the minimal draft viewer.
- Opening another user's private draft returns 403 or redirects to sign-in, depending on auth state.
- `--json` prints machine-readable output with at least `id`, `url`, and `createdAt`.
- Invalid paths, non-HTML files, oversized files, and missing auth return clear errors.
- Existing `push`, `/view`, file preview, teams, and shares continue to work.

## Verification Plan

- Unit test draft path normalization, title extraction, size limits, and access checks.
- Route test authenticated upload, unauthenticated rejection, owner access, non-owner rejection, and optional public access.
- CLI test output shape for default text and `--json`.
- Browser smoke test the minimal viewer at desktop and mobile widths with a representative dark HTML plan.
- Run `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run build`.

## Phased Work

- [x] Phase 1: Add draft schema, migration, shared types, and route skeleton.
- [x] Phase 2: Implement upload using dedicated draft storage and return clean draft URLs.
- [x] Phase 3: Add minimal authenticated draft viewer route and signed iframe content route.
- [x] Phase 4: Add CLI `draft` command with URL-first output and JSON mode.
- [x] Phase 5: Add focused tests for draft helpers, scope enforcement, shell sandboxing, and CLI behavior.
- [x] Phase 6: Document the command and security boundary in `HANDOFF.md`.
- [ ] Phase 7: Polish dashboard/listing only after the upload-to-URL loop feels excellent.

## Risks

- Same-origin hosted HTML can execute scripts under the app origin today. The longer-term fix is a separate content origin or signed content subdomain.
- Reusing git-backed storage is pragmatic, but draft metadata should be first-class so drafts are easy to list/delete without overloading generic files.
- Public links should be explicit opt-in. Private authenticated drafts should be the default.

## Implementation Review

- Evidence gathered: `HANDOFF.md`, current CLI/server/web code, `postplan.dev`, YouTube transcript, and sampled video frames from the relevant segment.
- Implemented first-class authenticated drafts with dedicated draft storage, signed content URLs, scoped API-token upload, and Postplan-style wrapper.
- Avoided using `/view` for draft iframe content after architecture review flagged same-origin HTML as a security boundary.
- Verification evidence: focused draft/scope tests pass; full `bun run check` passes.
