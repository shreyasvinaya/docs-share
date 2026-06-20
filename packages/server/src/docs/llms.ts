/**
 * Builds the `/llms.txt` document — a concise, machine-readable summary of
 * docs-share for LLMs and agents, following the llms.txt convention
 * (https://llmstxt.org). It points at the human docs, the OpenAPI spec, the
 * core concepts, the API base + auth, key endpoints, and the CLI commands.
 */

export interface LlmsTxtOptions {
  /** Public app URL (web UI). */
  appUrl: string;
  /** API base URL. */
  apiUrl: string;
}

export function buildLlmsTxt({ appUrl, apiUrl }: LlmsTxtOptions): string {
  const app = appUrl.replace(/\/+$/, "");
  const api = apiUrl.replace(/\/+$/, "");

  return `# docs-share

> docs-share is a self-hostable app for sharing documents across a team:
> upload files into git-backed repositories, publish single static HTML
> "drafts" as private authenticated URLs, and share content by email, with a
> team, or via public/org-restricted links. It ships a Hono + Bun server, a
> React web app, and a CLI optimized for AI-agent usage.

## Core concepts

- Repos: each user and each team owns a bare git repository. Files live in the
  repo and are served from an extracted worktree.
- Drafts: a single static HTML file published to a private URL (\`/d/<id>\`).
  Content is served via short-lived signed URLs. Scopes: \`draft:read\`,
  \`draft:write\`.
- Shares: grant access to a repo (or a path within it) by email, to a team, or
  via a public link. Public links support expiry, a password
  (\`X-Share-Password\` header), and org-domain restriction.
- Teams: groups of users with roles \`owner\`, \`admin\`, \`member\`, \`viewer\`.
  Team repos are addressed by team slug over git.
- Projects: lightweight metadata describing a subfolder of a repo.
- API tokens: \`ds_\`-prefixed bearer tokens with space/comma-separated scopes
  enforced on every authenticated endpoint: \`repo:read|write\`,
  \`project:read|write\`, \`share:read|write\`, \`team:read|write\`,
  \`user:read|write\`, \`admin:read|write\`, \`audit:read\`, \`draft:read|write\`,
  \`git:read|write\`, \`site-data:read|write\`, \`webhook:read|write\`, plus
  wildcards (\`*\`, \`repo:*\`, ...). Managing tokens (create/list/revoke under
  \`/api/auth/tokens\`) is SESSION-ONLY — a bearer token cannot mint or revoke
  tokens. Revoking a token is a soft delete (it sets \`revokedAt\`; the row is
  kept for audit).
- GitHub sync: import files into a repo from a GitHub repository/branch/path
  using a stored, encrypted GitHub token.
- Analytics & audit: owner-only view metrics per share/draft; an audit log of
  actor activity (sysadmins can read the whole install).
- Site data: targets (\`draft:<id>\` / \`repo:<id>\`) can opt into named form
  collections that accept PUBLIC, unauthenticated, rate-limited submissions.
- Webhooks: outbound, HMAC-signed event deliveries (\`X-DocsShare-Signature:
  sha256=<hex>\`) for \`share.created\`, \`share.revoked\`,
  \`github_sync.completed\`. The signing secret is shown only once at creation.

## API base and auth

- Base URL: ${api}
- Web app: ${app}
- Envelope: JSON endpoints return \`{ "data": ... }\`; errors return
  \`{ "error": ..., "details"?: ... }\`.
- Auth (web): \`ds_session\` cookie set by Google OAuth sign-in.
- Auth (automation): \`Authorization: Bearer ds_<token>\`.
- Auth (git): HTTP Basic over smart-HTTP; password is a \`ds_\` token.
- Full machine-readable contract: ${api}/openapi.json

## Key endpoints

- GET  ${api}/api/auth/session — current user
- POST ${api}/api/auth/tokens — create an API token (scopes, expiresIn; session-only)
- GET  ${api}/api/users/me — profile + personal repo
- GET/POST ${api}/api/teams — list/create teams
- GET/POST ${api}/api/projects — list/create projects
- GET  ${api}/api/files/{repoId} — list files (\`?path=\`)
- POST ${api}/api/files/{repoId}/upload — upload files (multipart)
- DELETE ${api}/api/files/{repoId} — delete a path (\`?path=\`)
- GET  ${api}/api/files/{repoId}/commits — recent commits
- POST ${api}/api/files/{repoId}/restore — restore a path/tree to a commit
- POST ${api}/api/files/{repoId}/copy — copy a path (optionally cross-repo)
- POST ${api}/api/drafts — publish an HTML draft (multipart \`file\`)
- GET  ${api}/api/drafts — list drafts
- POST ${api}/api/drafts/{draftId}/duplicate — duplicate a draft (draft:write)
- GET  ${api}/api/drafts/{draftId}/analytics — draft view metrics (owner, draft:read)
- POST ${api}/api/shares — create a share (email/public_link/team)
- GET  ${api}/api/shares/public/{token} — resolve a public share
- POST ${api}/api/shares/{shareId}/accept — accept an email share
- GET  ${api}/api/shares/{shareId}/analytics — share view metrics (creator only)
- POST ${api}/api/teams/invitations/{token}/accept — accept a team invitation
- GET  ${api}/api/audit — current user's audit entries
- GET  ${api}/api/audit/all — all audit entries (sysadmin only)
- GET  ${api}/api/admin/users — list users (sysadmin only)
- GET  ${api}/api/admin/branding — deployment branding (sysadmin only)
- POST ${api}/api/sites/{target}/data/{collection} — submit a form (PUBLIC, no auth)
- GET/POST ${api}/api/sites/{target}/collections — list/enable form collections (owner)
- GET  ${api}/api/sites/{target}/records — list form submissions (owner)
- POST ${api}/api/webhooks — create a webhook (secret returned once)
- GET  ${api}/api/webhooks — list webhooks (no secret)
- PATCH/DELETE ${api}/api/webhooks/{id} — update/delete a webhook (owner)
- POST ${api}/api/repos/{repoId}/github-sync — configure & run GitHub sync
- GET  ${api}/api/setup/branding — deployment name (public, no auth)
- GET  ${api}/api/setup/status — deployment setup checklist (sysadmin only)
- GET  ${api}/api/users/me/github-app/install — start GitHub App installation flow
- GET  ${api}/api/users/me/github-app/callback — GitHub App installation callback
- Git smart-HTTP: ${api}/git/{ownerType}/{ownerId}/info/refs?service=...

## CLI commands

The \`docs-share\` CLI wraps the API for agents and humans.

- docs-share login --token ds_... — store credentials
- docs-share whoami — print the current user
- docs-share push <files...> — upload files to a repo target
- docs-share draft <file.html> [--title T] [--json] — publish a draft URL
- docs-share ls — list files, teams, or shared items
- docs-share share — share files or create public links
- docs-share teams (create|members|invite) — manage teams

## Docs

- [Product Guide](${app}/docs/product-guide): drafts, uploads, teams, sharing.
- [Agent Guide](${app}/docs/agent-guide): CLI/API workflows for automation.
- [API Reference](${app}/docs/api-reference): per-endpoint reference + curl.
- [Deployment](${app}/docs/deployment): production checklist and hosts.
- [Self-Hosting](${app}/docs/self-hosting): required settings and backups.
- [OpenAPI](${api}/openapi.json): OpenAPI 3.1 specification.
`;
}
