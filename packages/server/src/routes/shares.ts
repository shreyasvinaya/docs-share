import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { generateId, generatePublicToken, hashToken } from "../lib/crypto.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

/**
 * POST / — Create a share.
 * Body varies by type: email, public_link, or team.
 */
app.post("/", requireAuth, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const { repoId, path, shareType } = body;

  if (!repoId || typeof repoId !== "string") {
    return c.json({ error: "repoId is required" }, 400);
  }
  if (!shareType || !["email", "public_link", "team"].includes(shareType)) {
    return c.json({ error: "Invalid shareType" }, 400);
  }

  // Verify the repo exists and user has write access (owns it or is a team member with write)
  const repo = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, repoId))
    .get();

  if (!repo) {
    return c.json({ error: "Repository not found" }, 404);
  }

  let hasAccess = false;

  if (repo.ownerType === "user" && repo.ownerUserId === userId) {
    hasAccess = true;
  } else if (repo.ownerType === "team" && repo.ownerTeamId) {
    const membership = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, repo.ownerTeamId),
          eq(schema.teamMembers.userId, userId)
        )
      )
      .get();

    if (membership && membership.role !== "viewer") {
      hasAccess = true;
    }
  }

  if (!hasAccess) {
    return c.json({ error: "Access denied" }, 403);
  }

  const shareId = generateId();

  if (shareType === "email") {
    const { emails, permission } = body;
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return c.json({ error: "At least one email is required" }, 400);
    }

    const sharePermission = permission === "write" ? "write" : "read";

    await db.insert(schema.shares).values({
      id: shareId,
      repoId,
      path: path || null,
      createdById: userId,
      shareType: "email",
      permission: sharePermission,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();

    // Create share recipients
    for (const email of emails) {
      // Try to find existing user by email
      const existingUser = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .get();

      await db.insert(schema.shareRecipients).values({
        id: generateId(),
        shareId,
        email,
        userId: existingUser?.id || null,
        createdAt: new Date().toISOString(),
      }).run();
    }

    const share = await db
      .select()
      .from(schema.shares)
      .where(eq(schema.shares.id, shareId))
      .get();

    const recipients = await db
      .select()
      .from(schema.shareRecipients)
      .where(eq(schema.shareRecipients.shareId, shareId))
      .all();

    return c.json({ data: { ...share, recipients } }, 201);
  }

  if (shareType === "public_link") {
    const { expiresIn, password } = body;

    const publicToken = generatePublicToken();
    let expiresAt: string | null = null;

    if (expiresIn) {
      const duration = parseDuration(expiresIn);
      if (duration) {
        expiresAt = new Date(Date.now() + duration).toISOString();
      }
    }

    let passwordHash: string | null = null;
    if (password) {
      passwordHash = hashToken(password);
    }

    await db.insert(schema.shares).values({
      id: shareId,
      repoId,
      path: path || null,
      createdById: userId,
      shareType: "public_link",
      permission: "read",
      publicToken,
      passwordHash,
      expiresAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();

    const share = await db
      .select()
      .from(schema.shares)
      .where(eq(schema.shares.id, shareId))
      .get();

    return c.json({ data: { ...share, publicToken } }, 201);
  }

  if (shareType === "team") {
    const { teamId, permission } = body;
    if (!teamId || typeof teamId !== "string") {
      return c.json({ error: "teamId is required" }, 400);
    }

    const sharePermission = permission === "write" ? "write" : "read";

    // Verify team exists
    const team = await db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId))
      .get();

    if (!team) {
      return c.json({ error: "Team not found" }, 404);
    }

    await db.insert(schema.shares).values({
      id: shareId,
      repoId,
      path: path || null,
      createdById: userId,
      shareType: "team",
      permission: sharePermission,
      teamId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();

    const share = await db
      .select()
      .from(schema.shares)
      .where(eq(schema.shares.id, shareId))
      .get();

    return c.json({ data: share }, 201);
  }

  return c.json({ error: "Invalid shareType" }, 400);
});

/**
 * GET / — List shares created by current user.
 */
app.get("/", requireAuth, async (c) => {
  const userId = c.get("userId");

  const userShares = await db
    .select()
    .from(schema.shares)
    .where(eq(schema.shares.createdById, userId))
    .all();

  return c.json({ data: userShares });
});

/**
 * GET /incoming — List shares where current user is a recipient.
 * Joins shareRecipients on user's email.
 */
app.get("/incoming", requireAuth, async (c) => {
  const userId = c.get("userId");

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const incoming = await db
    .select({
      share: schema.shares,
      recipientId: schema.shareRecipients.id,
      acceptedAt: schema.shareRecipients.acceptedAt,
    })
    .from(schema.shareRecipients)
    .innerJoin(schema.shares, eq(schema.shareRecipients.shareId, schema.shares.id))
    .where(eq(schema.shareRecipients.email, user.email))
    .all();

  return c.json({
    data: incoming.map((row) => ({
      ...row.share,
      recipientId: row.recipientId,
      acceptedAt: row.acceptedAt,
    })),
  });
});

/**
 * DELETE /:shareId — Revoke share. Requires auth + must be creator.
 */
app.delete("/:shareId", requireAuth, async (c) => {
  const userId = c.get("userId");
  const shareId = c.req.param("shareId");

  const share = await db
    .select()
    .from(schema.shares)
    .where(eq(schema.shares.id, shareId))
    .get();

  if (!share) {
    return c.json({ error: "Share not found" }, 404);
  }

  if (share.createdById !== userId) {
    return c.json({ error: "Only the creator can revoke this share" }, 403);
  }

  await db.delete(schema.shares).where(eq(schema.shares.id, shareId)).run();

  return c.json({ data: { deleted: true } });
});

/**
 * GET /public/:token — Resolve public share link. No auth required.
 * Returns share metadata + repo/path info. Checks expiry.
 */
app.get("/public/:token", async (c) => {
  const token = c.req.param("token");

  const share = await db
    .select()
    .from(schema.shares)
    .where(
      and(
        eq(schema.shares.publicToken, token),
        eq(schema.shares.shareType, "public_link")
      )
    )
    .get();

  if (!share) {
    return c.json({ error: "Share not found or invalid token" }, 404);
  }

  // Check expiry
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return c.json({ error: "This share link has expired" }, 410);
  }

  // Get repo info
  const repo = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, share.repoId))
    .get();

  return c.json({
    data: {
      id: share.id,
      repoId: share.repoId,
      path: share.path,
      permission: share.permission,
      expiresAt: share.expiresAt,
      hasPassword: !!share.passwordHash,
      repo: repo
        ? { id: repo.id, ownerType: repo.ownerType }
        : null,
    },
  });
});

/**
 * Parse a human-readable duration string (e.g., "7d", "24h", "30m") into milliseconds.
 */
function parseDuration(input: string): number | null {
  const match = input.match(/^(\d+)(m|h|d|w)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

export default app;
