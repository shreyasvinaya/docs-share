# Product Guide

docs-share is a self-hostable static document publishing app for teams and
coding agents. It stores uploaded files in Git-backed repositories, extracts the
latest tree for browsing and previewing, and can publish a single authenticated
HTML draft URL for fast agent-to-human handoff.

This guide focuses on practical use. For deployment details, read
[Self-Hosting](self-hosting.md) and [Deployment](deployment.md).

## Core Concepts

- **Personal space**: every user gets a personal repository. Use it for drafts,
  one-off HTML bundles, and files that should start private.
- **Team space**: each team gets a shared repository. Members can upload,
  replace, delete, preview, and share files according to their access.
- **Repository path**: files are addressed by their path in the repository, such
  as `index.html`, `reports/q2.html`, or `assets/app.css`.
- **Preview URL**: authenticated `/view/:repoId/...` URL that serves the current
  extracted repository tree.
- **Public share URL**: `/view/public/:token/...` URL created from a file or
  directory share.
- **Draft URL**: authenticated `/d/:draftId` URL created from one uploaded HTML
  file through `docs-share draft`.

The public website and hosted docs live at `/` and `/docs`. The authenticated
dashboard lives at `/app`, while existing app URLs such as `/files`, `/teams`,
`/shared`, `/settings`, and `/preview/:repoId/...` remain at their original
paths for bookmark and preview compatibility.

Use repository uploads when you need linked pages, CSS, images, history, team
collaboration, or public links. Use draft publishing when an agent needs to
publish one standalone HTML document and return one clean URL immediately.

## Auth And Dev Login

Production auth uses Google OAuth:

1. Open the app.
2. Sign in with Google.
3. Create an API token in **Settings -> API Tokens** when CLI or agent access is
   needed.
4. Copy the token immediately. It is only shown once.

Local development can use the dev login flow when `.env` has:

```bash
ENABLE_DEV_LOGIN=true
```

Then sign in with any email address and password:

```text
dev
```

Disable dev login in production with:

```bash
ENABLE_DEV_LOGIN=false
```

API tokens default to `*` scope from the web UI. Draft upload and deletion
accept tokens with `*`, `draft:*`, or `draft:write`; draft list and lookup
accept tokens with `*`, `draft:*`, or `draft:read`.

Revoking a token in **Settings -> API Tokens** is a soft-revoke: the token row
is preserved for audit (shown with a **Revoked** badge and revocation date) but
is immediately rejected for authentication. Revoked tokens cannot be revoked
again and are never reactivated — create a new token instead.

## Publishing A Single Authenticated HTML Draft

Draft publishing is optimized for agent output:

```bash
docs-share login --token ds_...
docs-share draft examples/standalone-draft.html
```

The command prints only the draft URL by default:

```text
https://docs.example.com/d/<draft-id>
```

Use JSON when another tool needs structured output:

```bash
docs-share draft examples/standalone-draft.html --json
```

Use a display title override when the HTML title is not useful:

```bash
docs-share draft plan.html --title "Migration Plan"
```

Draft rules:

- Only one `.html` or `.htm` file is accepted.
- Maximum upload size is 10 MB.
- The server derives the title from `<title>`, then `<h1>`, then the filename,
  unless `--title` is provided.
- The returned `/d/:draftId` page requires the owner to be signed in.
- Drafts are stored under `DATA_DIR/drafts/_drafts/<draftId>/index.html`.
- Draft content is loaded through a short-lived signed `/draft-content/:draftId`
  URL on `CONTENT_ORIGIN`.

The draft viewer is intentionally minimal: a 28px dark bar labeled `Postplan`
and an iframe containing the uploaded HTML. It does not show the full app shell,
file tree, history, or share dialog.

Open **Drafts** in the authenticated web app to search owner drafts, open a
draft URL, copy its URL, or delete the draft record and stored HTML.

## Uploading Static HTML Bundles

Use the web app or CLI when the draft has linked files.

### Web Upload

1. Open **My Files** for personal uploads, or a team page for team uploads.
2. Drop files into the upload area, click **browse**, or choose a folder.
3. Folder uploads preserve relative paths.
4. Open any uploaded file to preview it.

If a repository root contains `index.html`, opening the repository preview
redirects to that page. Otherwise, the preview page asks you to pick a file or
folder.

### CLI Upload

Upload a directory into your personal repository:

```bash
docs-share push ./examples/linked-draft --to personal --message "Publish linked draft"
```

Upload into a subfolder:

```bash
docs-share push ./site --to personal/plans/migration --message "Publish migration plan"
```

Upload into a team repository:

```bash
docs-share push ./site --to product-team/q2-plan --message "Publish team plan"
```

The CLI preserves directory paths and prints preview URLs for each uploaded
file.

## Updating Files And Folders

docs-share treats repository uploads as Git commits.

In the web app:

- Use **Replace** on a file to upload a new version at the same path.
- Use **Update** on a folder to upload a folder selection into that path.
- Use **History** on the preview page to inspect recent commits for the current
  file.

In the CLI, re-run `docs-share push` with the same target path:

```bash
docs-share push ./site --to personal/plans/migration --message "Update migration plan"
```

If the uploaded content has not changed, the server reports that no file changes
were detected.

## Restoring A Previous Version

Repositories are Git-backed, so any earlier version of a file can be brought
back without rewriting history.

- Open a file on the preview page and click **History**.
- On any older commit, click **Restore this version**. The server checks out the
  file content from that commit and records it as a **new** commit on top of the
  current history. Nothing is lost — the intervening versions remain in the log.

The API endpoint is `POST /api/files/:repoId/restore` with body
`{ "sha": "<commit>", "path": "<file path>" }`. Omit `path` to restore the whole
repository tree to the chosen revision.

## Duplicating Files And Drafts

- **Repository file or folder**: `POST /api/files/:repoId/copy` with body
  `{ "sourcePath": "a.html", "targetPath": "b.html" }`. The copy is committed as
  a new commit and indexed as an independent blob. Pass `targetRepoId` to copy
  into another repository you can write to.
- **Draft**: in the **Drafts** view choose **Duplicate**, or run
  `docs-share draft-duplicate <draftId>`. This copies the stored HTML into a new
  draft titled `"<original> (copy)"`; the copy is fully independent of the
  original.

## Deleting Files And Folders

In the file tree, use **Delete** on a file or folder. The server commits a Git
removal for the selected repository path and re-indexes the extracted worktree.

Deletion is permanent from the current UI perspective, but the Git repository
keeps commit history. Treat team deletions as shared changes.

## Personal And Team Spaces

Personal files belong to the signed-in user. Team files belong to a team
repository.

Use **Teams -> New Team** to create a team. Team settings let you:

- Add or edit the team description.
- Invite members by email.
- Assign `viewer`, `member`, or `admin` roles.
- Delete the team.

The CLI uses target strings:

- `personal`
- `personal/subfolder`
- `<team-slug>`
- `<team-slug>/subfolder`

List teams from the CLI:

```bash
docs-share teams
```

Create and manage teams:

```bash
docs-share teams create "Product Team"
docs-share teams members product-team
docs-share teams invite product-team teammate@example.com --role member
```

## Sharing

Repository files and directories can be shared by email, team, or link.

From the web preview or file tree:

1. Click **Share**.
2. Choose **Email**, **Team**, or **Link**.
3. For email/team shares, choose read or write access.
4. For links, choose public access or organization-only access.

From the CLI:

```bash
docs-share share personal/report.html --with user@example.com
docs-share share personal/report.html --with editor@example.com --write
docs-share share personal/reports --public
docs-share share product-team/q2-plan --public --expires 7d
docs-share share personal/report.html --revoke user@example.com
```

Important share behavior:

- Share a directory when HTML depends on sibling pages, CSS, JavaScript, images,
  or fonts.
- File-only shares expose only that file. Relative links to sibling assets will
  fail unless those assets are included by sharing a containing directory.
- Public links use `/view/public/:token`.
- Organization-only links require sign-in and a matching email domain.
- Public links can expire when created with `--expires`.
- Email shares send notification email when `RESEND_API_KEY` and `EMAIL_FROM`
  are configured.
- Share activity posts to Slack when `SLACK_WEBHOOK_URL` is configured.

Draft URLs are not the same as public share links. Current draft URLs are
private to the creating user and are not team-shareable from the UI.

## Preview Behavior

Authenticated repository previews use:

```text
/view/:repoId/<path>
```

Public share previews use:

```text
/view/public/:token/<path>
```

Preview serving details:

- Directories redirect to a trailing slash and then serve `index.html` if one is
  present.
- Common static MIME types are set for HTML, CSS, JavaScript, JSON, Markdown,
  images, PDFs, ZIP files, fonts, XML, YAML, and TOML.
- Repository preview iframes use `sandbox="allow-scripts allow-same-origin"`.
- Served repository files include CSP and content-type protection headers.
- Draft viewer iframes use `sandbox="allow-scripts"` and signed content URLs.

Use a separate `CONTENT_ORIGIN` in production so draft HTML runs on a clean
content host boundary.

## CSS, Assets, And Sample Files

For one-file drafts, inline CSS and data URLs are the simplest path. Use:

```bash
docs-share draft examples/standalone-draft.html
```

For linked assets, publish the whole folder:

```bash
docs-share push examples/linked-draft --to personal/linked-draft
```

The linked example includes:

- `examples/linked-draft/index.html`
- `examples/linked-draft/architecture.html`
- `examples/linked-draft/checklist.html`
- `examples/linked-draft/styles.css`

Relative links such as `./styles.css` and `./checklist.html` work when the
folder structure is preserved.

## Operational Notes

Persistent state lives under `DATA_DIR`:

- `docs-share.db`
- `docs-share.db-wal`
- `docs-share.db-shm`
- `repos/`
- `worktrees/`
- `drafts/`

Back up the whole directory or Docker volume. Stop writes or use a filesystem
snapshot that is consistent for SQLite WAL files.

Production settings to review:

- Set `SESSION_SECRET`, `DRAFT_CONTENT_SECRET`, and `HOOK_SECRET` to separate
  32+ character random values.
- Set `APP_URL`, `API_URL`, and `CONTENT_ORIGIN` to public HTTPS URLs.
- Put TLS in front of the app.
- Allow large upload request bodies at the proxy/platform layer.
- Keep `ENABLE_DEV_LOGIN=false`.
- Set `GITHUB_TOKEN_SECRET` so per-user GitHub tokens can be encrypted at rest.
- Set `EMAIL_FROM` plus `RESEND_API_KEY` for share notification emails.
- Set `SLACK_WEBHOOK_URL` for Slack share/activity notifications.
- Use `/health` for platform health checks.

For upgrades, back up `DATA_DIR`, deploy the new image or source, then check
`/health`.
