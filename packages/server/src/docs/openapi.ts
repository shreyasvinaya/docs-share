/**
 * Hand-authored OpenAPI 3.1 specification for the docs-share HTTP API.
 *
 * This document enumerates every server endpoint exposed by the Hono app
 * (see `src/index.ts` and `src/routes/*.ts`). It is served verbatim at
 * `GET /openapi.json` and is the source of truth for the API reference guide
 * in `docs/api-reference.md`.
 *
 * Endpoints fall into a few authentication categories:
 *  - Cookie session (`ds_session`) — used by the web app.
 *  - Bearer API token (`Authorization: Bearer ds_...`) — used by the CLI and
 *    automation. Tokens carry scopes such as `draft:read`, `draft:write`, and
 *    `git:*`.
 *  - HTTP Basic over the git smart-HTTP transport (token as the password).
 *  - Public (no auth) — share links, the spec itself, and `llms.txt`.
 */

export interface OpenApiSpec {
  openapi: string;
  info: Record<string, unknown>;
  servers: Array<Record<string, unknown>>;
  tags: Array<Record<string, unknown>>;
  paths: Record<string, unknown>;
  components: Record<string, unknown>;
}

const bearerAuth = [{ bearerAuth: [] }];
const sessionAuth = [{ sessionCookie: [] }];
const sessionOrBearer = [{ sessionCookie: [] }, { bearerAuth: [] }];

const errorResponse = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
    },
  },
});

export const openApiSpec: OpenApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "docs-share API",
    version: "0.1.0",
    summary: "Self-hostable team document sharing.",
    description:
      "HTTP API for docs-share — a self-hostable app for sharing documents, " +
      "static HTML drafts, and git-backed repositories across teams. " +
      "Most JSON endpoints wrap their payload in a `{ \"data\": ... }` envelope. " +
      "Authenticate web requests with the `ds_session` cookie, and automation " +
      "with a `ds_` API token sent as `Authorization: Bearer ds_...`.",
    license: { name: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
  },
  servers: [
    { url: "http://localhost:3000", description: "Local development" },
    { url: "https://docs.example.com", description: "Self-hosted production (replace with your host)" },
  ],
  tags: [
    { name: "auth", description: "OAuth sign-in, sessions, and API tokens" },
    { name: "users", description: "Current user profile and GitHub token" },
    { name: "teams", description: "Teams and team membership" },
    { name: "projects", description: "Project metadata for repo subfolders" },
    { name: "repos", description: "Repository lookups and GitHub sync" },
    { name: "files", description: "Listing, uploading, and deleting repo files" },
    { name: "drafts", description: "Single-file authenticated HTML drafts" },
    { name: "shares", description: "Email, team, and public-link shares" },
    { name: "view", description: "Serving extracted repo and share content" },
    { name: "git", description: "Git smart-HTTP transport" },
    { name: "setup", description: "Deployment branding and setup status" },
    { name: "meta", description: "Health, OpenAPI spec, and llms.txt" },
  ],
  paths: {
    // ---------------------------------------------------------------------
    // meta
    // ---------------------------------------------------------------------
    "/health": {
      get: {
        tags: ["meta"],
        summary: "Health check",
        security: [],
        responses: {
          "200": {
            description: "Service is up",
            content: {
              "application/json": {
                schema: { type: "object", properties: { ok: { type: "boolean" } } },
              },
            },
          },
        },
      },
    },
    "/openapi.json": {
      get: {
        tags: ["meta"],
        summary: "This OpenAPI 3.1 specification",
        security: [],
        responses: {
          "200": {
            description: "OpenAPI document",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/llms.txt": {
      get: {
        tags: ["meta"],
        summary: "Machine-readable project summary (llms.txt convention)",
        security: [],
        responses: {
          "200": {
            description: "Plain-text summary",
            content: { "text/plain": { schema: { type: "string" } } },
          },
        },
      },
    },

    // ---------------------------------------------------------------------
    // auth
    // ---------------------------------------------------------------------
    "/api/auth/google": {
      get: {
        tags: ["auth"],
        summary: "Begin Google OAuth sign-in",
        security: [],
        parameters: [
          {
            name: "next",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Relative path to redirect to after sign-in.",
          },
        ],
        responses: {
          "302": { description: "Redirect to the Google consent screen" },
        },
      },
    },
    "/api/auth/google/callback": {
      get: {
        tags: ["auth"],
        summary: "Google OAuth callback",
        security: [],
        parameters: [
          { name: "code", in: "query", required: true, schema: { type: "string" } },
          { name: "state", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "302": { description: "Sets the `ds_session` cookie and redirects to the app" },
          "400": errorResponse("Invalid OAuth state or missing code"),
          "500": errorResponse("Failed to fetch user info or create user"),
        },
      },
    },
    "/api/auth/dev-login": {
      post: {
        tags: ["auth"],
        summary: "Development username/password login",
        description:
          "Only available when not in production and `ENABLE_DEV_LOGIN=true`. " +
          "Accepts any email with password `dev`.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Session created",
            content: {
              "application/json": {
                schema: { type: "object", properties: { user: { $ref: "#/components/schemas/User" } } },
              },
            },
          },
          "400": errorResponse("Email and password required"),
          "401": errorResponse("Invalid credentials"),
          "404": errorResponse("Dev login disabled"),
        },
      },
    },
    "/api/auth/logout": {
      post: {
        tags: ["auth"],
        summary: "Log out and clear the session cookie",
        security: sessionAuth,
        responses: {
          "200": {
            description: "Logged out",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } },
          },
        },
      },
    },
    "/api/auth/session": {
      get: {
        tags: ["auth"],
        summary: "Current session user",
        security: sessionOrBearer,
        responses: {
          "200": {
            description: "Authenticated user",
            content: {
              "application/json": {
                schema: { type: "object", properties: { user: { $ref: "#/components/schemas/User" } } },
              },
            },
          },
          "401": errorResponse("Not authenticated"),
          "404": errorResponse("User not found"),
        },
      },
    },
    "/api/auth/tokens": {
      get: {
        tags: ["auth"],
        summary: "List the current user's API tokens (masked)",
        security: sessionOrBearer,
        responses: {
          "200": {
            description: "Token list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { tokens: { type: "array", items: { $ref: "#/components/schemas/ApiTokenMasked" } } },
                },
              },
            },
          },
          "401": errorResponse("Not authenticated"),
        },
      },
      post: {
        tags: ["auth"],
        summary: "Create an API token",
        description: "Returns the plaintext `ds_` token exactly once.",
        security: sessionOrBearer,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  scopes: {
                    type: "string",
                    description: "Space- or comma-separated scopes (e.g. `draft:write git:*`). Defaults to `*`.",
                  },
                  expiresIn: { type: "integer", description: "Lifetime in seconds." },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Token created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ApiTokenCreated" } } },
          },
          "400": errorResponse("Token name is required"),
          "401": errorResponse("Not authenticated"),
        },
      },
    },
    "/api/auth/tokens/{tokenId}": {
      delete: {
        tags: ["auth"],
        summary: "Delete an API token",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/TokenId" }],
        responses: {
          "200": { description: "Deleted", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } },
          "401": errorResponse("Not authenticated"),
          "404": errorResponse("Token not found"),
        },
      },
    },

    // ---------------------------------------------------------------------
    // users
    // ---------------------------------------------------------------------
    "/api/users/me": {
      get: {
        tags: ["users"],
        summary: "Current user profile and personal repo",
        security: sessionOrBearer,
        responses: {
          "200": {
            description: "Profile",
            content: { "application/json": { schema: { $ref: "#/components/schemas/MeEnvelope" } } },
          },
          "401": errorResponse("Not authenticated"),
          "404": errorResponse("User not found"),
        },
      },
      patch: {
        tags: ["users"],
        summary: "Update editable profile fields",
        security: sessionOrBearer,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  displayName: { type: "string", maxLength: 100 },
                  designation: { type: ["string", "null"], maxLength: 120 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated user", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("Invalid field"),
          "401": errorResponse("Not authenticated"),
        },
      },
    },
    "/api/users/me/github-app/install": {
      get: {
        tags: ["users"],
        summary: "Redirect to GitHub App install page",
        description:
          "Generates a CSRF state, stores it in a short-lived cookie, then redirects " +
          "the browser to the GitHub App installation URL. Returns `503` if the " +
          "GitHub App integration is not configured on this deployment.",
        security: sessionOrBearer,
        responses: {
          "302": { description: "Redirect to the GitHub App installation page" },
          "503": errorResponse("GitHub App integration is not configured"),
        },
      },
    },
    "/api/users/me/github-app/callback": {
      get: {
        tags: ["users"],
        summary: "GitHub App installation callback",
        description:
          "GitHub redirects here after the user installs/authorizes the App. " +
          "Verifies the state cookie, exchanges the OAuth code, confirms the user " +
          "has access to the installation, and stores the installation credentials. " +
          "On success, redirects to `/settings?tab=integrations`.",
        security: sessionOrBearer,
        parameters: [
          {
            name: "installation_id",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "GitHub App installation ID.",
          },
          {
            name: "state",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "CSRF state token, must match the stored cookie.",
          },
          {
            name: "code",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "GitHub OAuth authorization code.",
          },
        ],
        responses: {
          "302": { description: "Redirect to /settings on success" },
          "400": errorResponse("Invalid or missing state, installation_id, or code"),
          "403": errorResponse("User is not authorized for this GitHub App installation"),
          "502": errorResponse("GitHub authorization or installation lookup failed"),
          "503": errorResponse("GitHub App OAuth is not configured"),
        },
      },
    },
    "/api/users/me/github-token": {
      get: {
        tags: ["users"],
        summary: "GitHub token connection status",
        security: sessionOrBearer,
        responses: {
          "200": {
            description: "Connection status",
            content: { "application/json": { schema: { $ref: "#/components/schemas/GitHubTokenStatusEnvelope" } } },
          },
          "401": errorResponse("Not authenticated"),
          "404": errorResponse("User not found"),
        },
      },
      put: {
        tags: ["users"],
        summary: "Store an encrypted GitHub token",
        security: sessionOrBearer,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["token"], properties: { token: { type: "string", minLength: 20 } } },
            },
          },
        },
        responses: {
          "200": { description: "Stored", content: { "application/json": { schema: { $ref: "#/components/schemas/GitHubTokenStatusEnvelope" } } } },
          "400": errorResponse("A GitHub token is required"),
          "401": errorResponse("Not authenticated"),
        },
      },
      delete: {
        tags: ["users"],
        summary: "Remove the stored GitHub token",
        security: sessionOrBearer,
        responses: {
          "200": { description: "Removed", content: { "application/json": { schema: { $ref: "#/components/schemas/GitHubTokenStatusEnvelope" } } } },
          "401": errorResponse("Not authenticated"),
        },
      },
    },

    // ---------------------------------------------------------------------
    // setup
    // ---------------------------------------------------------------------
    "/api/setup/branding": {
      get: {
        tags: ["setup"],
        summary: "Public deployment branding",
        description: "Returns the configured deployment name. Available without authentication.",
        security: [],
        responses: {
          "200": {
            description: "Branding info",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        deploymentName: { type: "string" },
                      },
                      required: ["deploymentName"],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/setup/status": {
      get: {
        tags: ["setup"],
        summary: "Deployment setup checklist (sysadmin only)",
        description:
          "Returns the full setup status for this deployment. " +
          "Requires an authenticated sysadmin (session or bearer token).",
        security: sessionOrBearer,
        responses: {
          "200": {
            description: "Setup status",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SetupStatusEnvelope" },
              },
            },
          },
          "401": errorResponse("Not authenticated"),
          "403": errorResponse("Sysadmin role required"),
        },
      },
    },

    // ---------------------------------------------------------------------
    // teams
    // ---------------------------------------------------------------------
    "/api/teams": {
      get: {
        tags: ["teams"],
        summary: "List teams the current user belongs to",
        security: sessionOrBearer,
        responses: {
          "200": { description: "Teams", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "401": errorResponse("Not authenticated"),
        },
      },
      post: {
        tags: ["teams"],
        summary: "Create a team",
        security: sessionOrBearer,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "slug"],
                properties: {
                  name: { type: "string", maxLength: 100 },
                  slug: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 50 },
                  description: { type: ["string", "null"], maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Team created", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("Invalid input"),
          "401": errorResponse("Not authenticated"),
          "409": errorResponse("Team slug already taken"),
        },
      },
    },
    "/api/teams/{teamId}": {
      get: {
        tags: ["teams"],
        summary: "Get team details",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/TeamId" }],
        responses: {
          "200": { description: "Team", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "403": errorResponse("Not a team member"),
          "404": errorResponse("Team not found"),
        },
      },
      patch: {
        tags: ["teams"],
        summary: "Update team name/description (owner or admin)",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/TeamId" }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", maxLength: 100 },
                  description: { type: ["string", "null"], maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("Invalid input"),
          "403": errorResponse("Only owners and admins can update the team"),
        },
      },
      delete: {
        tags: ["teams"],
        summary: "Delete a team (owner only)",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/TeamId" }],
        responses: {
          "200": { description: "Deleted", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "403": errorResponse("Only the owner can delete the team"),
        },
      },
    },
    "/api/teams/{teamId}/members": {
      get: {
        tags: ["teams"],
        summary: "List team members",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/TeamId" }],
        responses: {
          "200": { description: "Members", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "403": errorResponse("Not a team member"),
        },
      },
      post: {
        tags: ["teams"],
        summary: "Invite a member by email (owner or admin)",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/TeamId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  email: { type: "string", format: "email" },
                  role: { type: "string", enum: ["owner", "admin", "member", "viewer"], default: "member" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Invited", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("Email is required"),
          "403": errorResponse("Only owners and admins can invite members"),
          "409": errorResponse("Already a member or invite already sent"),
        },
      },
    },
    "/api/teams/{teamId}/members/{userId}": {
      patch: {
        tags: ["teams"],
        summary: "Change a member's role (owner only)",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/TeamId" }, { $ref: "#/components/parameters/MemberUserId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["role"],
                properties: { role: { type: "string", enum: ["owner", "admin", "member", "viewer"] } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("Invalid role"),
          "403": errorResponse("Only owners can change member roles"),
          "404": errorResponse("Member not found"),
        },
      },
      delete: {
        tags: ["teams"],
        summary: "Remove a member (owner/admin, or self-leave)",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/TeamId" }, { $ref: "#/components/parameters/MemberUserId" }],
        responses: {
          "200": { description: "Removed", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("Cannot remove the last owner"),
          "403": errorResponse("Only owners and admins can remove members"),
          "404": errorResponse("Member not found"),
        },
      },
    },

    // ---------------------------------------------------------------------
    // projects
    // ---------------------------------------------------------------------
    "/api/projects": {
      get: {
        tags: ["projects"],
        summary: "List projects",
        security: sessionOrBearer,
        parameters: [
          { name: "ownerType", in: "query", schema: { type: "string", enum: ["user", "team"] } },
          { name: "ownerId", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Projects", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "403": errorResponse("Not authorized for the requested owner"),
        },
      },
      post: {
        tags: ["projects"],
        summary: "Create a project",
        security: sessionOrBearer,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "slug", "ownerType"],
                properties: {
                  name: { type: "string", maxLength: 100 },
                  slug: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 50 },
                  description: { type: ["string", "null"] },
                  ownerType: { type: "string", enum: ["user", "team"] },
                  ownerTeamId: { type: "string" },
                  ownerUserId: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Project created", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("Invalid input"),
          "403": errorResponse("Must be a team member"),
          "409": errorResponse("Project slug already exists"),
        },
      },
    },
    "/api/projects/{projectId}": {
      get: {
        tags: ["projects"],
        summary: "Get project details",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        responses: {
          "200": { description: "Project", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "404": errorResponse("Project not found"),
        },
      },
      patch: {
        tags: ["projects"],
        summary: "Update project name/description",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", maxLength: 100 },
                  description: { type: ["string", "null"], maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("Invalid input"),
          "403": errorResponse("Permission denied"),
          "404": errorResponse("Project not found"),
        },
      },
      delete: {
        tags: ["projects"],
        summary: "Delete project metadata (owner only)",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/ProjectId" }],
        responses: {
          "200": { description: "Deleted", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "403": errorResponse("Only the owner can delete a project"),
          "404": errorResponse("Project not found"),
        },
      },
    },

    // ---------------------------------------------------------------------
    // repos / github-sync
    // ---------------------------------------------------------------------
    "/api/repos/{repoId}/github-sync": {
      get: {
        tags: ["repos"],
        summary: "Current GitHub sync configuration for a repo",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/RepoId" }],
        responses: {
          "200": { description: "Sync config (or null)", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "403": errorResponse("No read access"),
        },
      },
      post: {
        tags: ["repos"],
        summary: "Configure and run a GitHub sync",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/RepoId" }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  repoUrl: { type: "string", description: "https://github.com/<owner>/<repo>" },
                  branch: { type: "string", default: "main" },
                  sourcePath: { type: "string", description: "Subfolder of the GitHub repo to import." },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Sync succeeded", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("Invalid repoUrl, branch, or path"),
          "403": errorResponse("No write access"),
          "404": errorResponse("Repository not found"),
          "502": errorResponse("GitHub sync failed"),
        },
      },
    },
    "/api/repos/{repoId}/github-sync/repositories": {
      get: {
        tags: ["repos"],
        summary: "List GitHub repositories accessible to the stored token",
        security: sessionOrBearer,
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          { name: "ownerLogin", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Repositories", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "403": errorResponse("No read access"),
          "502": errorResponse("GitHub repository lookup failed"),
        },
      },
    },
    "/api/repos/{repoId}/github-sync/organizations": {
      get: {
        tags: ["repos"],
        summary: "List GitHub organizations for the stored token",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/RepoId" }],
        responses: {
          "200": { description: "Organizations", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "403": errorResponse("No read access"),
          "502": errorResponse("GitHub organization lookup failed"),
        },
      },
    },
    "/api/repos/{repoId}/github-sync/branches": {
      get: {
        tags: ["repos"],
        summary: "List branches for a GitHub repo URL",
        security: sessionOrBearer,
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          { name: "repoUrl", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Branches", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("repoUrl is required"),
          "403": errorResponse("No read access"),
          "502": errorResponse("GitHub branch lookup failed"),
        },
      },
    },
    "/api/repos/{repoId}/github-sync/tree": {
      get: {
        tags: ["repos"],
        summary: "List the file tree of a GitHub repo at a branch/path",
        security: sessionOrBearer,
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          { name: "repoUrl", in: "query", required: true, schema: { type: "string" } },
          { name: "branch", in: "query", schema: { type: "string", default: "main" } },
          { name: "path", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Tree nodes", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("repoUrl is required"),
          "403": errorResponse("No read access"),
          "502": errorResponse("GitHub tree lookup failed"),
        },
      },
    },

    // ---------------------------------------------------------------------
    // files
    // ---------------------------------------------------------------------
    "/api/files/{repoId}": {
      get: {
        tags: ["files"],
        summary: "List files at the repo root or a subpath",
        security: sessionOrBearer,
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          { name: "path", in: "query", schema: { type: "string" }, description: "Directory prefix." },
        ],
        responses: {
          "200": {
            description: "File nodes",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { data: { type: "array", items: { $ref: "#/components/schemas/FileNode" } } },
                },
              },
            },
          },
          "403": errorResponse("No read access"),
        },
      },
      delete: {
        tags: ["files"],
        summary: "Delete a file or directory and commit the removal",
        security: sessionOrBearer,
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          { name: "path", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Deleted", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("path is required"),
          "403": errorResponse("No write access"),
          "404": errorResponse("File or directory not found"),
          "500": errorResponse("Git operation failed"),
        },
      },
    },
    "/api/files/{repoId}/commits": {
      get: {
        tags: ["files"],
        summary: "List recent commits (optionally for a single path)",
        security: sessionOrBearer,
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          { name: "path", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          "200": {
            description: "Commits",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { data: { type: "array", items: { $ref: "#/components/schemas/Commit" } } },
                },
              },
            },
          },
          "403": errorResponse("No read access"),
          "404": errorResponse("Repository not found"),
          "500": errorResponse("Failed to read git log"),
        },
      },
    },
    "/api/files/{repoId}/upload": {
      post: {
        tags: ["files"],
        summary: "Upload files and commit them",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/RepoId" }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  files: { type: "array", items: { type: "string", format: "binary" } },
                  path: { type: "string", description: "Target directory within the repo." },
                  message: { type: "string", description: "Commit message." },
                  manifest: { type: "string", description: "JSON array of relative paths matching the files." },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Uploaded", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("Invalid path, manifest, or no files provided"),
          "403": errorResponse("No write access"),
          "404": errorResponse("Repository or user not found"),
          "500": errorResponse("Git operation failed"),
        },
      },
    },

    // ---------------------------------------------------------------------
    // drafts
    // ---------------------------------------------------------------------
    "/api/drafts": {
      get: {
        tags: ["drafts"],
        summary: "List the current user's drafts",
        description: "Requires the `draft:read` scope when using an API token.",
        security: sessionOrBearer,
        responses: {
          "200": {
            description: "Drafts",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { data: { type: "array", items: { $ref: "#/components/schemas/DraftListItem" } } },
                },
              },
            },
          },
          "401": errorResponse("Not authenticated"),
          "403": errorResponse("Token scope does not allow this action"),
        },
      },
      post: {
        tags: ["drafts"],
        summary: "Upload a single HTML draft",
        description: "Requires the `draft:write` scope when using an API token.",
        security: sessionOrBearer,
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: { type: "string", format: "binary", description: "A single static HTML file." },
                  title: { type: "string", description: "Optional title override." },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Draft created",
            content: {
              "application/json": {
                schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Draft" } } },
              },
            },
          },
          "400": errorResponse("Draft file is required or invalid"),
          "401": errorResponse("Not authenticated"),
          "403": errorResponse("Token scope does not allow this action"),
          "404": errorResponse("User not found"),
        },
      },
    },
    "/api/drafts/{draftId}": {
      get: {
        tags: ["drafts"],
        summary: "Get draft metadata",
        description: "Requires the `draft:read` scope when using an API token.",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/DraftId" }],
        responses: {
          "200": { description: "Draft", content: { "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Draft" } } } } } },
          "403": errorResponse("Access denied or scope insufficient"),
          "404": errorResponse("Draft not found"),
        },
      },
      delete: {
        tags: ["drafts"],
        summary: "Delete a draft",
        description: "Requires the `draft:write` scope when using an API token.",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/DraftId" }],
        responses: {
          "200": { description: "Deleted", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "403": errorResponse("Access denied or scope insufficient"),
          "404": errorResponse("Draft not found"),
          "500": errorResponse("Failed to delete draft content"),
        },
      },
    },

    // ---------------------------------------------------------------------
    // shares
    // ---------------------------------------------------------------------
    "/api/shares": {
      get: {
        tags: ["shares"],
        summary: "List shares created by the current user",
        security: sessionOrBearer,
        responses: {
          "200": { description: "Shares", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "401": errorResponse("Not authenticated"),
        },
      },
      post: {
        tags: ["shares"],
        summary: "Create a share (email, public_link, or team)",
        security: sessionOrBearer,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["repoId", "shareType"],
                properties: {
                  repoId: { type: "string" },
                  path: { type: ["string", "null"] },
                  shareType: { type: "string", enum: ["email", "public_link", "team"] },
                  emails: { type: "array", items: { type: "string", format: "email" } },
                  permission: { type: "string", enum: ["read", "write"], default: "read" },
                  teamId: { type: "string" },
                  expiresIn: { type: "string", description: "Duration like `7d`, `12h`, `30m`, `2w`." },
                  password: { type: "string" },
                  linkAccess: { type: "string", enum: ["public", "org"], default: "public" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Share created", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("Invalid shareType or input"),
          "403": errorResponse("Access denied"),
          "404": errorResponse("Team not found"),
        },
      },
    },
    "/api/shares/for-resource": {
      get: {
        tags: ["shares"],
        summary: "List shares for a specific repo + path",
        security: sessionOrBearer,
        parameters: [
          { name: "repoId", in: "query", required: true, schema: { type: "string" } },
          { name: "path", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Shares", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "400": errorResponse("repoId is required"),
          "403": errorResponse("Access denied"),
        },
      },
    },
    "/api/shares/incoming": {
      get: {
        tags: ["shares"],
        summary: "List shares where the current user is a recipient",
        security: sessionOrBearer,
        responses: {
          "200": { description: "Incoming shares", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "401": errorResponse("Not authenticated"),
          "404": errorResponse("User not found"),
        },
      },
    },
    "/api/shares/{shareId}": {
      delete: {
        tags: ["shares"],
        summary: "Revoke a share (creator only)",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/ShareId" }],
        responses: {
          "200": { description: "Revoked", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "403": errorResponse("Only the creator can revoke this share"),
          "404": errorResponse("Share not found"),
        },
      },
    },
    "/api/shares/public/{token}": {
      get: {
        tags: ["shares"],
        summary: "Resolve public share link metadata",
        security: [],
        parameters: [
          { $ref: "#/components/parameters/ShareToken" },
          { $ref: "#/components/parameters/SharePassword" },
        ],
        responses: {
          "200": { description: "Share metadata (may require password or auth)", content: { "application/json": { schema: { $ref: "#/components/schemas/DataEnvelope" } } } },
          "403": errorResponse("Access denied"),
          "404": errorResponse("Share not found or invalid token"),
          "410": errorResponse("This share link has expired"),
        },
      },
    },

    // ---------------------------------------------------------------------
    // view (content serving)
    // ---------------------------------------------------------------------
    "/view/public/{token}": {
      get: {
        tags: ["view"],
        summary: "Serve a file-level public share",
        security: [],
        parameters: [
          { $ref: "#/components/parameters/ShareToken" },
          { $ref: "#/components/parameters/SharePassword" },
        ],
        responses: {
          "200": { description: "File content" },
          "302": { description: "Redirect to the org sign-in gate (browser navigations)" },
          "400": errorResponse("No file specified or invalid path"),
          "401": errorResponse("Authentication required (org link)"),
          "403": errorResponse("Access denied or password required"),
          "404": errorResponse("Invalid share link"),
          "410": errorResponse("This share link has expired"),
        },
      },
    },
    "/view/public/{token}/{path}": {
      get: {
        tags: ["view"],
        summary: "Serve a file within a directory share",
        security: [],
        parameters: [
          { $ref: "#/components/parameters/ShareToken" },
          { name: "path", in: "path", required: true, schema: { type: "string" }, description: "File path within the share." },
          { $ref: "#/components/parameters/SharePassword" },
        ],
        responses: {
          "200": { description: "File content" },
          "302": { description: "Redirect to the org sign-in gate" },
          "400": errorResponse("Invalid path"),
          "401": errorResponse("Authentication required (org link)"),
          "403": errorResponse("Access denied or password required"),
          "404": errorResponse("Invalid share link"),
          "410": errorResponse("This share link has expired"),
        },
      },
    },
    "/view/{repoId}": {
      get: {
        tags: ["view"],
        summary: "Serve the repo root (index.html) to authorized users",
        security: sessionOrBearer,
        parameters: [{ $ref: "#/components/parameters/RepoId" }],
        responses: {
          "200": { description: "File content" },
          "403": errorResponse("Access denied"),
          "404": errorResponse("File not found"),
        },
      },
    },
    "/view/{repoId}/{path}": {
      get: {
        tags: ["view"],
        summary: "Serve a repo file to authorized users",
        security: sessionOrBearer,
        parameters: [
          { $ref: "#/components/parameters/RepoId" },
          { name: "path", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "File content" },
          "403": errorResponse("Access denied"),
          "404": errorResponse("File not found"),
        },
      },
    },

    // ---------------------------------------------------------------------
    // drafts content (signed)
    // ---------------------------------------------------------------------
    "/d/{draftId}": {
      get: {
        tags: ["drafts"],
        summary: "Render a draft viewer shell (requires session)",
        security: sessionAuth,
        parameters: [{ $ref: "#/components/parameters/DraftId" }],
        responses: {
          "200": { description: "HTML viewer shell", content: { "text/html": { schema: { type: "string" } } } },
          "302": { description: "Redirect to /login when unauthenticated" },
          "403": { description: "Access denied" },
          "404": { description: "Draft not found" },
        },
      },
    },
    "/draft-content/{draftId}": {
      get: {
        tags: ["drafts"],
        summary: "Serve signed draft HTML content",
        security: [],
        parameters: [
          { $ref: "#/components/parameters/DraftId" },
          { name: "exp", in: "query", required: true, schema: { type: "string" }, description: "Signed expiry (ms epoch)." },
          { name: "sig", in: "query", required: true, schema: { type: "string" }, description: "HMAC signature." },
        ],
        responses: {
          "200": { description: "Draft HTML", content: { "text/html": { schema: { type: "string" } } } },
          "403": { description: "Invalid or expired content URL" },
          "404": { description: "Draft not found" },
        },
      },
    },

    // ---------------------------------------------------------------------
    // git smart-HTTP
    // ---------------------------------------------------------------------
    "/git/{ownerType}/{ownerId}/info/refs": {
      get: {
        tags: ["git"],
        summary: "Git reference discovery (smart-HTTP)",
        description: "Authenticate with HTTP Basic where the password is a `ds_` API token with `git:read`/`git:write` scope.",
        security: [{ basicAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/OwnerType" },
          { $ref: "#/components/parameters/OwnerId" },
          { name: "service", in: "query", required: true, schema: { type: "string", enum: ["git-upload-pack", "git-receive-pack"] } },
        ],
        responses: {
          "200": { description: "pkt-line ref advertisement", content: { "application/x-git-upload-pack-advertisement": { schema: { type: "string" } } } },
          "400": { description: "Invalid service" },
          "401": { description: "Authentication required" },
          "404": { description: "Repository not found" },
        },
      },
    },
    "/git/{ownerType}/{ownerId}/git-upload-pack": {
      post: {
        tags: ["git"],
        summary: "Git fetch (upload-pack)",
        security: [{ basicAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/OwnerType" }, { $ref: "#/components/parameters/OwnerId" }],
        requestBody: { content: { "application/x-git-upload-pack-request": { schema: { type: "string", format: "binary" } } } },
        responses: {
          "200": { description: "Pack result", content: { "application/x-git-upload-pack-result": { schema: { type: "string" } } } },
          "401": { description: "Authentication required" },
          "404": { description: "Repository not found" },
        },
      },
    },
    "/git/{ownerType}/{ownerId}/git-receive-pack": {
      post: {
        tags: ["git"],
        summary: "Git push (receive-pack)",
        security: [{ basicAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/OwnerType" }, { $ref: "#/components/parameters/OwnerId" }],
        requestBody: { content: { "application/x-git-receive-pack-request": { schema: { type: "string", format: "binary" } } } },
        responses: {
          "200": { description: "Pack result", content: { "application/x-git-receive-pack-result": { schema: { type: "string" } } } },
          "401": { description: "Authentication required" },
          "404": { description: "Repository not found" },
        },
      },
    },

  },
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "ds_session", description: "Web session cookie." },
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "ds_<token>",
        description: "API token created via POST /api/auth/tokens. Send as `Authorization: Bearer ds_...`.",
      },
      basicAuth: { type: "http", scheme: "basic", description: "Git smart-HTTP: any username, password is a `ds_` token." },
    },
    parameters: {
      RepoId: { name: "repoId", in: "path", required: true, schema: { type: "string" } },
      TeamId: { name: "teamId", in: "path", required: true, schema: { type: "string" } },
      MemberUserId: { name: "userId", in: "path", required: true, schema: { type: "string" } },
      ProjectId: { name: "projectId", in: "path", required: true, schema: { type: "string" } },
      DraftId: { name: "draftId", in: "path", required: true, schema: { type: "string" } },
      ShareId: { name: "shareId", in: "path", required: true, schema: { type: "string" } },
      TokenId: { name: "tokenId", in: "path", required: true, schema: { type: "string" } },
      ShareToken: { name: "token", in: "path", required: true, schema: { type: "string" }, description: "Public share token." },
      OwnerType: { name: "ownerType", in: "path", required: true, schema: { type: "string", enum: ["user", "team"] } },
      OwnerId: { name: "ownerId", in: "path", required: true, schema: { type: "string" }, description: "User id or team slug." },
      SharePassword: {
        name: "X-Share-Password",
        in: "header",
        required: false,
        schema: { type: "string" },
        description: "Password for a password-protected public share.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          details: { type: "string" },
        },
        required: ["error"],
      },
      Ok: { type: "object", properties: { ok: { type: "boolean" } } },
      DataEnvelope: {
        type: "object",
        properties: { data: {} },
        description: "Standard `{ data }` response envelope.",
      },
      User: {
        type: "object",
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          displayName: { type: "string" },
          designation: { type: ["string", "null"] },
          avatarUrl: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      MeEnvelope: {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: {
              id: { type: "string" },
              email: { type: "string" },
              displayName: { type: "string" },
              designation: { type: ["string", "null"] },
              avatarUrl: { type: ["string", "null"] },
              createdAt: { type: "string" },
              repo: { type: ["object", "null"] },
            },
          },
        },
      },
      GitHubTokenStatusEnvelope: {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: {
              connected: { type: "boolean", description: "Whether any GitHub credential (App or PAT) is stored." },
              connectionType: {
                type: ["string", "null"],
                enum: ["github_app", "pat", null],
                description: "How the GitHub credential is stored.",
              },
              configured: { type: "boolean", description: "Whether the GitHub App integration is configured on this deployment." },
              updatedAt: { type: ["string", "null"], description: "ISO-8601 timestamp of when the credential was last updated." },
              installationId: { type: ["string", "null"], description: "GitHub App installation ID (null for PAT connections)." },
              accountLogin: { type: ["string", "null"], description: "GitHub account login for the App installation." },
              accountType: { type: ["string", "null"], description: "GitHub account type ('User' or 'Organization')." },
            },
            required: ["connected", "connectionType", "configured"],
          },
        },
      },
      SetupStatusEnvelope: {
        type: "object",
        properties: {
          data: {
            type: "object",
            description: "Full deployment setup checklist.",
            properties: {
              deploymentName: { type: "string" },
              environment: {
                type: "object",
                properties: {
                  production: { type: "boolean" },
                  appUrl: { $ref: "#/components/schemas/SetupCheck" },
                  contentOrigin: { $ref: "#/components/schemas/SetupCheck" },
                  devLogin: { $ref: "#/components/schemas/SetupCheck" },
                },
              },
              sysadmin: { $ref: "#/components/schemas/SetupCheck" },
              authentication: {
                type: "object",
                properties: {
                  googleOAuth: { $ref: "#/components/schemas/SetupCheck" },
                },
              },
              integrations: {
                type: "object",
                properties: {
                  githubApp: { $ref: "#/components/schemas/SetupCheck" },
                  githubPatFallback: { $ref: "#/components/schemas/SetupCheck" },
                },
              },
              security: {
                type: "object",
                properties: {
                  productionSecrets: { $ref: "#/components/schemas/SetupCheck" },
                },
              },
            },
          },
        },
      },
      SetupCheck: {
        type: "object",
        properties: {
          configured: { type: "boolean" },
          label: { type: "string" },
          detail: { type: "string" },
        },
        required: ["configured", "label", "detail"],
      },
      ApiTokenMasked: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          tokenPrefix: { type: "string" },
          scopes: { type: "string" },
          expiresAt: { type: ["string", "null"] },
          lastUsedAt: { type: ["string", "null"] },
          createdAt: { type: "string" },
        },
      },
      ApiTokenCreated: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          token: { type: "string", description: "Plaintext `ds_` token, shown only once." },
          prefix: { type: "string" },
          scopes: { type: "string" },
          expiresAt: { type: ["string", "null"] },
          createdAt: { type: "string" },
        },
      },
      FileNode: {
        type: "object",
        properties: {
          name: { type: "string" },
          path: { type: "string" },
          type: { type: "string", enum: ["file", "directory"] },
          sizeBytes: { type: ["integer", "null"] },
          mimeType: { type: ["string", "null"] },
          updatedAt: { type: ["string", "null"] },
        },
      },
      Commit: {
        type: "object",
        properties: {
          sha: { type: "string" },
          message: { type: "string" },
          authorName: { type: "string" },
          authorEmail: { type: "string" },
          date: { type: "string", format: "date-time" },
        },
      },
      Draft: {
        type: "object",
        properties: {
          id: { type: "string" },
          url: { type: "string", format: "uri" },
          title: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      DraftListItem: {
        type: "object",
        allOf: [
          { $ref: "#/components/schemas/Draft" },
          {
            type: "object",
            properties: {
              sourceFilename: { type: "string" },
              sizeBytes: { type: "integer" },
              updatedAt: { type: "string", format: "date-time" },
            },
          },
        ],
      },
    },
  },
};
