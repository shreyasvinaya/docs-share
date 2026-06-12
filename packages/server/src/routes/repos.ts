import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { checkAccess } from "../middleware/shareAccess.js";
import { generateId } from "../lib/crypto.js";
import {
  normalizeGitBranch,
  normalizeGitHubRepoUrl,
  syncGitHubRepo,
} from "../services/githubSync.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

app.use("*", requireAuth);

app.get("/:repoId/github-sync", checkAccess("read"), async (c) => {
  const repoId = c.req.param("repoId");
  const sync = await db
    .select()
    .from(schema.githubSyncs)
    .where(eq(schema.githubSyncs.repoId, repoId))
    .get();

  return c.json({ data: sync ?? null });
});

app.post("/:repoId/github-sync", checkAccess("write"), async (c) => {
  const repoId = c.req.param("repoId");
  const body = await c.req.json<{
    repoUrl?: string;
    branch?: string;
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
  if (!repoUrl) {
    return c.json({ error: "repoUrl is required for the first sync" }, 400);
  }

  const normalizedUrl = normalizeGitHubRepoUrl(repoUrl);
  const normalizedBranch = normalizeGitBranch(branch);
  if (!normalizedUrl) {
    return c.json({ error: "Only public https://github.com/<owner>/<repo> URLs are supported" }, 400);
  }
  if (!normalizedBranch) {
    return c.json({ error: "Invalid GitHub branch name" }, 400);
  }

  const now = new Date().toISOString();
  if (existing) {
    await db
      .update(schema.githubSyncs)
      .set({
        repoUrl: normalizedUrl,
        branch: normalizedBranch,
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
        status: "syncing",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  try {
    const result = await syncGitHubRepo(repo, normalizedUrl, normalizedBranch);
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

    return c.json({ data: sync }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
