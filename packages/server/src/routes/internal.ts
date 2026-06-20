import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { spawnWithTimeout } from "../git/gitOps.js";
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
    if (ownerId !== c.get("userId")) {
      return c.json({ error: "Access denied" }, 403);
    }

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

  const validUpdate = await validateGitUpdate(repo.diskPath, body.ref, body.newRev);
  if (!validUpdate) {
    return c.json({ error: "Invalid git update" }, 400);
  }

  // Extract files to worktree and index them in the database
  await extractRepoFiles(repo.id, repo.diskPath, body.newRev);
  await indexRepoFiles(repo.id, repo.diskPath, body.newRev);

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

async function validateGitUpdate(
  repoPath: string,
  ref: string,
  newRev: string
): Promise<boolean> {
  if (!ref.startsWith("refs/heads/")) return false;
  if (!/^[0-9a-f]{40}$/i.test(newRev)) return false;
  if (/^0{40}$/.test(newRev)) return false;

  // Route through the shared process-group timeout helper so a hung git can't
  // pin the request and any child it spawns is killed with it.
  const refCheck = await spawnWithTimeout(["git", "check-ref-format", ref], {
    env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
  });
  if (refCheck.exitCode !== 0) return false;

  const commitCheck = await spawnWithTimeout(
    ["git", "-C", repoPath, "cat-file", "-e", `${newRev}^{commit}`],
    { env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" } }
  );
  return commitCheck.exitCode === 0;
}

export default app;
