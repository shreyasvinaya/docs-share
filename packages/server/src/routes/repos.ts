import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { canReadRepoPath, canWriteRepoPath } from "../middleware/shareAccess.js";
import { createMiddleware } from "hono/factory";
import { generateId } from "../lib/crypto.js";
import {
  listGitHubAccessibleRepos,
  listGitHubBranches,
  listGitHubOrganizations,
  listGitHubRemoteTree,
  normalizeGitBranch,
  normalizeGitHubImportPath,
  normalizeGitHubRepoUrl,
  redactSensitiveGitOutput,
  syncGitHubRepo,
} from "../services/githubSync.js";
import { redactInternalPaths } from "../lib/security.js";
import { getUserGitHubCredential, getUserGitHubToken } from "./users.js";
import { scheduleWebhookDispatch } from "../services/webhooks.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

app.use("*", requireAuth);

/**
 * GitHub-sync endpoints configure and run a WHOLE-repo import. They are not
 * path-scoped operations, so a path-scoped share must never authorize them.
 * Require a repo-wide WRITE grant: owner, a non-viewer member of the owning
 * team, or a write share with NO path scope. `canWriteRepoPath(_, _, "")`
 * encodes exactly this (a path-scoped write share does not cover the empty
 * whole-repo target).
 */
const requireRepoWideWrite = createMiddleware<AppEnv>(async (c, next) => {
  const userId = c.get("userId");
  const repoId = c.req.param("repoId");

  if (!repoId) {
    return c.json({ error: "Missing repoId" }, 400);
  }

  const repo = await db
    .select({ id: schema.repos.id })
    .from(schema.repos)
    .where(eq(schema.repos.id, repoId))
    .get();
  if (!repo) {
    return c.json({ error: "Repository not found" }, 404);
  }

  if (!(await canWriteRepoPath(userId, repoId, ""))) {
    return c.json({ error: "Access denied" }, 403);
  }

  return next();
});

/**
 * The github-sync GET endpoints (config, repositories, organizations, branches,
 * tree) are read-only helpers for the import UI. They require a repo-wide READ
 * grant: owner, any team member of the owning team, or a read share with NO
 * path scope. `canReadRepoPath(_, _, "")` encodes exactly this — a path-scoped
 * share does not cover the empty whole-repo target, so it is still denied.
 */
const requireRepoWideRead = createMiddleware<AppEnv>(async (c, next) => {
  const userId = c.get("userId");
  const repoId = c.req.param("repoId");

  if (!repoId) {
    return c.json({ error: "Missing repoId" }, 400);
  }

  const repo = await db
    .select({ id: schema.repos.id })
    .from(schema.repos)
    .where(eq(schema.repos.id, repoId))
    .get();
  if (!repo) {
    return c.json({ error: "Repository not found" }, 404);
  }

  if (!(await canReadRepoPath(userId, repoId, ""))) {
    return c.json({ error: "Access denied" }, 403);
  }

  return next();
});

app.get("/:repoId/github-sync", requireRepoWideRead, async (c) => {
  const repoId = c.req.param("repoId");
  const sync = await db
    .select()
    .from(schema.githubSyncs)
    .where(eq(schema.githubSyncs.repoId, repoId))
    .get();

  return c.json({ data: sync ?? null });
});

app.get("/:repoId/github-sync/repositories", requireRepoWideRead, async (c) => {
  const userId = c.get("userId");
  const ownerLogin = c.req.query("ownerLogin") ?? "";

  try {
    const repositories = await listGitHubAccessibleRepos(
      await getUserGitHubCredential(userId),
      ownerLogin
    );
    return c.json({ data: repositories });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: "GitHub repository lookup failed", details: message }, 502);
  }
});

app.get("/:repoId/github-sync/organizations", requireRepoWideRead, async (c) => {
  const userId = c.get("userId");

  try {
    const organizations = await listGitHubOrganizations(
      await getUserGitHubCredential(userId)
    );
    return c.json({ data: organizations });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: "GitHub organization lookup failed", details: message }, 502);
  }
});

app.get("/:repoId/github-sync/branches", requireRepoWideRead, async (c) => {
  const userId = c.get("userId");
  const repoUrl = c.req.query("repoUrl");

  if (!repoUrl) {
    return c.json({ error: "repoUrl is required" }, 400);
  }

  try {
    const branches = await listGitHubBranches({
      repoUrl,
      token: await getUserGitHubToken(userId),
    });
    return c.json({ data: branches });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: "GitHub branch lookup failed", details: message }, 502);
  }
});

app.get("/:repoId/github-sync/tree", requireRepoWideRead, async (c) => {
  const userId = c.get("userId");
  const repoUrl = c.req.query("repoUrl");
  const branch = c.req.query("branch") ?? "main";
  const path = c.req.query("path") ?? "";

  if (!repoUrl) {
    return c.json({ error: "repoUrl is required" }, 400);
  }

  try {
    const nodes = await listGitHubRemoteTree({
      repoUrl,
      branch,
      path,
      token: await getUserGitHubToken(userId),
    });
    return c.json({ data: nodes });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: "GitHub tree lookup failed", details: message }, 502);
  }
});

app.post("/:repoId/github-sync", requireRepoWideWrite, async (c) => {
  const userId = c.get("userId");
  const repoId = c.req.param("repoId");
  const body = await c.req.json<{
    repoUrl?: string;
    branch?: string;
    sourcePath?: string;
  }>();

  const repo = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, repoId))
    .get();

  if (!repo) {
    return c.json({ error: "Repository not found" }, 404);
  }

  const existing = await db
    .select()
    .from(schema.githubSyncs)
    .where(eq(schema.githubSyncs.repoId, repoId))
    .get();

  const repoUrl = body.repoUrl ?? existing?.repoUrl;
  const branch = body.branch ?? existing?.branch ?? "main";
  const sourcePath = body.sourcePath ?? existing?.sourcePath ?? "";
  if (!repoUrl) {
    return c.json({ error: "repoUrl is required for the first sync" }, 400);
  }

  const normalizedUrl = normalizeGitHubRepoUrl(repoUrl);
  const normalizedBranch = normalizeGitBranch(branch);
  const normalizedSourcePath = normalizeGitHubImportPath(sourcePath);
  if (!normalizedUrl) {
    return c.json({ error: "Only https://github.com/<owner>/<repo> URLs are supported" }, 400);
  }
  if (!normalizedBranch) {
    return c.json({ error: "Invalid GitHub branch name" }, 400);
  }
  if (normalizedSourcePath === null) {
    return c.json({ error: "Invalid GitHub import path" }, 400);
  }

  const now = new Date().toISOString();
  if (existing) {
    await db
      .update(schema.githubSyncs)
      .set({
        repoUrl: normalizedUrl,
        branch: normalizedBranch,
        sourcePath: normalizedSourcePath,
        status: "syncing",
        error: null,
        updatedAt: now,
      })
      .where(eq(schema.githubSyncs.id, existing.id))
      .run();
  } else {
    await db
      .insert(schema.githubSyncs)
      .values({
        id: generateId(),
        repoId,
        repoUrl: normalizedUrl,
        branch: normalizedBranch,
        sourcePath: normalizedSourcePath,
        status: "syncing",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  try {
    const result = await syncGitHubRepo(
      repo,
      normalizedUrl,
      normalizedBranch,
      normalizedSourcePath,
      await getUserGitHubToken(userId)
    );
    await db
      .update(schema.githubSyncs)
      .set({
        lastCommitSha: result.commitSha,
        lastSyncedAt: result.syncedAt,
        status: "success",
        error: null,
        updatedAt: result.syncedAt,
      })
      .where(eq(schema.githubSyncs.repoId, repoId))
      .run();

    const sync = await db
      .select()
      .from(schema.githubSyncs)
      .where(eq(schema.githubSyncs.repoId, repoId))
      .get();

    // Fire-and-forget after the sync row has committed: webhook delivery must
    // not delay the sync response.
    scheduleWebhookDispatch({
      ownerUserId: userId,
      event: "github_sync.completed",
      data: {
        repoId,
        repoUrl: normalizedUrl,
        branch: normalizedBranch,
        sourcePath: normalizedSourcePath,
        commitSha: result.commitSha,
        syncedAt: result.syncedAt,
      },
    });

    return c.json({ data: sync }, 201);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    // Strip embedded credentials AND server-internal filesystem paths before
    // this message is persisted to the github_syncs row and returned to the
    // client. (Most git failures are already sanitized at the source, but other
    // errors — and the fallback `git <args> failed` text — can still embed the
    // temp clone path or repo.diskPath.) Full detail is kept server-side.
    if (error instanceof Error) {
      console.error("GitHub sync failed:", error);
    }
    const message = redactInternalPaths(redactSensitiveGitOutput(rawMessage));
    const failedAt = new Date().toISOString();
    await db
      .update(schema.githubSyncs)
      .set({
        status: "error",
        error: message,
        updatedAt: failedAt,
      })
      .where(eq(schema.githubSyncs.repoId, repoId))
      .run();
    return c.json({ error: "GitHub sync failed", details: message }, 502);
  }
});

export default app;
