import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  extractRepoFiles,
  indexRepoFiles,
} from "../services/fileExtractor.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// GET /repo — Look up repo by owner type + owner ID (for CLI usage)
// ---------------------------------------------------------------------------
app.get("/repo", requireAuth, async (c) => {
  const ownerType = c.req.query("ownerType");
  const ownerId = c.req.query("ownerId");

  if (!ownerType || !ownerId) {
    return c.json({ error: "ownerType and ownerId are required" }, 400);
  }

  let repo;

  if (ownerType === "user") {
    repo = await db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.ownerUserId, ownerId))
      .get();
  } else if (ownerType === "team") {
    // Verify the caller is a member of the team
    const userId = c.get("userId");
    const membership = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, ownerId),
          eq(schema.teamMembers.userId, userId)
        )
      )
      .get();

    if (!membership) {
      return c.json({ error: "Not a team member" }, 403);
    }

    repo = await db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.ownerTeamId, ownerId))
      .get();
  } else {
    return c.json({ error: "ownerType must be 'user' or 'team'" }, 400);
  }

  if (!repo) {
    return c.json({ error: "Repository not found" }, 404);
  }

  return c.json({
    data: {
      id: repo.id,
      ownerType: repo.ownerType,
      headSha: repo.headSha,
      sizeBytes: repo.sizeBytes,
      lastPushAt: repo.lastPushAt,
      createdAt: repo.createdAt,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /hooks/post-receive — Called by the git post-receive hook
// ---------------------------------------------------------------------------

app.post("/hooks/post-receive", async (c) => {
  const secret = c.req.header("X-Hook-Secret");
  if (secret !== config.HOOK_SECRET) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = await c.req.json<{
    repoPath: string;
    ref: string;
    oldRev: string;
    newRev: string;
  }>();

  // Find the repo record by its diskPath
  const repo = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.diskPath, body.repoPath))
    .get();

  if (!repo) {
    return c.json({ error: "Repository not found" }, 404);
  }

  // Extract files to worktree and index them in the database
  await extractRepoFiles(repo.id, body.repoPath, body.ref);
  await indexRepoFiles(repo.id, body.repoPath, body.ref);

  // Update the repo's lastPushAt and headSha
  await db
    .update(schema.repos)
    .set({
      lastPushAt: new Date().toISOString(),
      headSha: body.newRev,
    })
    .where(eq(schema.repos.id, repo.id))
    .run();

  return c.json({ ok: true });
});

export default app;
