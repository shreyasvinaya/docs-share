import { Hono } from "hono";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { generateId, generatePublicToken, hashToken } from "../lib/crypto.js";
import { config } from "../lib/config.js";
import {
  buildEmailShareNotification,
  buildSlackShareNotification,
  sendShareEmailNotifications,
  sendSlackNotification,
} from "../services/notifications.js";
import {
  aggregateViewStats,
  recordAuditEntrySafe,
} from "../services/analytics.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

async function toSharedItem(share: typeof schema.shares.$inferSelect) {
  const owner = await db
    .select({
      displayName: schema.users.displayName,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(eq(schema.users.id, share.createdById))
    .get();

  return {
    share,
    fileName: share.path?.split("/").filter(Boolean).pop() ?? "All files",
    ownerName: owner?.displayName ?? "Unknown",
    ownerEmail: owner?.email ?? "",
  };
}

async function checkRepoAccess(
  repoId: string,
  userId: string
): Promise<boolean> {
  const repo = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, repoId))
    .get();

  if (!repo) return false;

  if (repo.ownerType === "user" && repo.ownerUserId === userId) {
    return true;
  }

  if (repo.ownerType === "team" && repo.ownerTeamId) {
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
      return true;
    }
  }

  return false;
}

async function notifyShareCreated(params: {
  createdById: string;
  shareType: "email" | "team" | "public_link";
  permission: "read" | "write";
  path: string | null;
  recipientEmails?: string[];
}): Promise<void> {
  const creator = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, params.createdById))
    .get();
  const sharerName = creator?.displayName ?? creator?.email ?? "Someone";
  const resourceLabel = params.path || "All files";

  try {
    if (params.shareType === "email" && params.recipientEmails?.length) {
      await sendShareEmailNotifications({
        apiKey: config.RESEND_API_KEY,
        from: config.EMAIL_FROM,
        messages: params.recipientEmails.map((recipientEmail) =>
          buildEmailShareNotification({
            appUrl: config.APP_URL,
            recipientEmail,
            sharerName,
            resourceLabel,
          })
        ),
      });
    }

    await sendSlackNotification({
      webhookUrl: config.SLACK_WEBHOOK_URL,
      text: buildSlackShareNotification({
        appUrl: config.APP_URL,
        sharerName,
        resourceLabel,
        shareType: params.shareType,
        permission: params.permission,
      }),
    });
  } catch (error) {
    console.warn(
      "Share notification failed",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * GET /for-resource — Get existing shares for a specific repoId+path.
 */
app.get("/for-resource", requireAuth, async (c) => {
  const userId = c.get("userId");
  const repoId = c.req.query("repoId");
  const path = c.req.query("path") || null;

  if (!repoId) {
    return c.json({ error: "repoId is required" }, 400);
  }

  const hasAccess = await checkRepoAccess(repoId, userId);
  if (!hasAccess) {
    return c.json({ error: "Access denied" }, 403);
  }

  let shares;
  if (path) {
    shares = await db
      .select()
      .from(schema.shares)
      .where(
        and(eq(schema.shares.repoId, repoId), eq(schema.shares.path, path))
      )
      .all();
  } else {
    shares = await db
      .select()
      .from(schema.shares)
      .where(
        and(eq(schema.shares.repoId, repoId), isNull(schema.shares.path))
      )
      .all();
  }

  return c.json({ data: shares });
});

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

  const hasAccess = await checkRepoAccess(repoId, userId);
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

    await db
      .insert(schema.shares)
      .values({
        id: shareId,
        repoId,
        path: path || null,
        createdById: userId,
        shareType: "email",
        permission: sharePermission,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    for (const email of emails) {
      const existingUser = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .get();

      await db
        .insert(schema.shareRecipients)
        .values({
          id: generateId(),
          shareId,
          email,
          userId: existingUser?.id || null,
          createdAt: new Date().toISOString(),
        })
        .run();
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

    await notifyShareCreated({
      createdById: userId,
      shareType: "email",
      permission: sharePermission,
      path: path || null,
      recipientEmails: emails,
    });

    recordAuditEntrySafe({
      actorUserId: userId,
      action: "share.created",
      targetType: "share",
      targetId: shareId,
      metadata: {
        shareType: "email",
        repoId,
        path: path || null,
        recipientCount: emails.length,
      },
    });

    return c.json({ data: { ...share, recipients } }, 201);
  }

  if (shareType === "public_link") {
    const { expiresIn, password, linkAccess } = body;
    const access = linkAccess === "org" ? "org" : "public";

    // Extract org domain from creator's email
    const creator = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();

    const orgDomain =
      access === "org" && creator
        ? creator.email.split("@")[1] || null
        : null;

    // Check for existing public_link share on same repoId+path
    let existingShare;
    if (path) {
      existingShare = await db
        .select()
        .from(schema.shares)
        .where(
          and(
            eq(schema.shares.repoId, repoId),
            eq(schema.shares.path, path),
            eq(schema.shares.shareType, "public_link")
          )
        )
        .get();
    } else {
      existingShare = await db
        .select()
        .from(schema.shares)
        .where(
          and(
            eq(schema.shares.repoId, repoId),
            isNull(schema.shares.path),
            eq(schema.shares.shareType, "public_link")
          )
        )
        .get();
    }

    if (existingShare) {
      const updates: Record<string, string | null> = {
        linkAccess: access,
        orgDomain,
        updatedAt: new Date().toISOString(),
      };

      if ("password" in body) {
        updates.passwordHash = password ? hashToken(password) : null;
      }

      if ("expiresIn" in body) {
        const duration = expiresIn ? parseDuration(expiresIn) : null;
        updates.expiresAt = duration
          ? new Date(Date.now() + duration).toISOString()
          : null;
      }

      await db
        .update(schema.shares)
        .set(updates)
        .where(eq(schema.shares.id, existingShare.id))
        .run();

      const updated = await db
        .select()
        .from(schema.shares)
        .where(eq(schema.shares.id, existingShare.id))
        .get();

      await notifyShareCreated({
        createdById: userId,
        shareType: "public_link",
        permission: "read",
        path: path || null,
      });

      recordAuditEntrySafe({
        actorUserId: userId,
        action: "share.updated",
        targetType: "share",
        targetId: existingShare.id,
        metadata: { shareType: "public_link", repoId, path: path || null, linkAccess: access },
      });

      return c.json({ data: { ...updated, publicToken: updated!.publicToken } });
    }

    // Create new public link
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

    await db
      .insert(schema.shares)
      .values({
        id: shareId,
        repoId,
        path: path || null,
        createdById: userId,
        shareType: "public_link",
        permission: "read",
        publicToken,
        linkAccess: access,
        orgDomain,
        passwordHash,
        expiresAt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    const share = await db
      .select()
      .from(schema.shares)
      .where(eq(schema.shares.id, shareId))
      .get();

    await notifyShareCreated({
      createdById: userId,
      shareType: "public_link",
      permission: "read",
      path: path || null,
    });

    recordAuditEntrySafe({
      actorUserId: userId,
      action: "share.created",
      targetType: "share",
      targetId: shareId,
      metadata: { shareType: "public_link", repoId, path: path || null, linkAccess: access },
    });

    return c.json({ data: { ...share, publicToken } }, 201);
  }

  if (shareType === "team") {
    const { teamId, permission } = body;
    if (!teamId || typeof teamId !== "string") {
      return c.json({ error: "teamId is required" }, 400);
    }

    const sharePermission = permission === "write" ? "write" : "read";

    const team = await db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId))
      .get();

    if (!team) {
      return c.json({ error: "Team not found" }, 404);
    }

    const targetMembership = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, userId)
        )
      )
      .get();

    if (!targetMembership) {
      return c.json({ error: "You can only share with teams you belong to" }, 403);
    }

    const existingShare = await db
      .select()
      .from(schema.shares)
      .where(
        path
          ? and(
              eq(schema.shares.repoId, repoId),
              eq(schema.shares.path, path),
              eq(schema.shares.shareType, "team"),
              eq(schema.shares.teamId, teamId)
            )
          : and(
              eq(schema.shares.repoId, repoId),
              isNull(schema.shares.path),
              eq(schema.shares.shareType, "team"),
              eq(schema.shares.teamId, teamId)
            )
      )
      .get();

    if (existingShare) {
      await db
        .update(schema.shares)
        .set({
          permission: sharePermission,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.shares.id, existingShare.id))
        .run();

      const share = await db
        .select()
        .from(schema.shares)
        .where(eq(schema.shares.id, existingShare.id))
        .get();

      await notifyShareCreated({
        createdById: userId,
        shareType: "team",
        permission: sharePermission,
        path: path || null,
      });

      recordAuditEntrySafe({
        actorUserId: userId,
        action: "share.updated",
        targetType: "share",
        targetId: existingShare.id,
        metadata: { shareType: "team", repoId, path: path || null, teamId },
      });

      return c.json({ data: share });
    }

    await db
      .insert(schema.shares)
      .values({
        id: shareId,
        repoId,
        path: path || null,
        createdById: userId,
        shareType: "team",
        permission: sharePermission,
        teamId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    const share = await db
      .select()
      .from(schema.shares)
      .where(eq(schema.shares.id, shareId))
      .get();

    await notifyShareCreated({
      createdById: userId,
      shareType: "team",
      permission: sharePermission,
      path: path || null,
    });

    recordAuditEntrySafe({
      actorUserId: userId,
      action: "share.created",
      targetType: "share",
      targetId: shareId,
      metadata: { shareType: "team", repoId, path: path || null, teamId },
    });

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
    .innerJoin(
      schema.shares,
      eq(schema.shareRecipients.shareId, schema.shares.id)
    )
    .where(eq(schema.shareRecipients.email, user.email))
    .all();

  const memberships = await db
    .select({ teamId: schema.teamMembers.teamId })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.userId, userId))
    .all();

  const teamIds = memberships.map((membership) => membership.teamId);
  const teamShares = teamIds.length
    ? await db
        .select({ share: schema.shares })
        .from(schema.shares)
        .where(
          and(
            eq(schema.shares.shareType, "team"),
            inArray(schema.shares.teamId, teamIds)
          )
        )
        .all()
    : [];

  const sharedItems = await Promise.all([
    ...incoming.map((row) => toSharedItem(row.share)),
    ...teamShares.map((row) => toSharedItem(row.share)),
  ]);

  return c.json({ data: sharedItems });
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

  recordAuditEntrySafe({
    actorUserId: userId,
    action: "share.revoked",
    targetType: "share",
    targetId: shareId,
    metadata: { shareType: share.shareType, repoId: share.repoId, path: share.path },
  });

  return c.json({ data: { deleted: true } });
});

/**
 * GET /:shareId/analytics — View metrics for a share, restricted to its creator.
 *
 * Intentionally OWNER-ONLY: per-share analytics are scoped to the share creator
 * and are deliberately NOT widened to sysadmins. Sysadmins use the audit log
 * (cross-actor, no per-visitor data) for oversight, not per-share view metrics.
 */
app.get("/:shareId/analytics", requireAuth, async (c) => {
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

  // Owner-only gate (see handler doc): do not widen to sysadmins.
  if (share.createdById !== userId) {
    return c.json({ error: "Only the creator can view analytics" }, 403);
  }

  // public_link views are recorded under the "public" target type; all other
  // share types are recorded under "share". Pick the matching bucket.
  const targetType = share.shareType === "public_link" ? "public" : "share";
  const stats = await aggregateViewStats(targetType, share.id);

  return c.json({ data: stats });
});

/**
 * GET /public/:token — Resolve public share link metadata. No auth required.
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

  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return c.json({ error: "This share link has expired" }, 410);
  }

  if (share.passwordHash) {
    const providedPassword = c.req.header("X-Share-Password");
    if (!providedPassword || hashToken(providedPassword) !== share.passwordHash) {
      return c.json({
        data: {
          id: share.id,
          linkAccess: share.linkAccess,
          orgDomain: share.orgDomain,
          expiresAt: share.expiresAt,
          hasPassword: true,
        },
      });
    }
  }

  if (share.linkAccess === "org" && share.orgDomain) {
    const userId = c.get("userId");
    if (!userId) {
      return c.json({
        data: {
          id: share.id,
          linkAccess: share.linkAccess,
          orgDomain: share.orgDomain,
          expiresAt: share.expiresAt,
          hasPassword: !!share.passwordHash,
          requiresAuth: true,
        },
      });
    }

    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();

    if (user?.email.split("@")[1] !== share.orgDomain) {
      return c.json({ error: "Access denied" }, 403);
    }
  }

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
      linkAccess: share.linkAccess,
      orgDomain: share.orgDomain,
      expiresAt: share.expiresAt,
      hasPassword: !!share.passwordHash,
      repo: repo ? { id: repo.id, ownerType: repo.ownerType } : null,
    },
  });
});

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
