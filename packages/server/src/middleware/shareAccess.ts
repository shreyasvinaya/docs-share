import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { AppEnv } from "../lib/types.js";

/**
 * Middleware factory that checks whether the authenticated user has the
 * required permission level ("read" or "write") on the repo identified
 * by the :repoId route param.
 *
 * Access is granted if any of the following are true:
 *   1. The user owns the repo directly (ownerType="user", ownerUserId matches).
 *   2. The user is a member of the team that owns the repo (ownerType="team").
 *      For "write" permission, the member role must be owner/admin/member (not viewer).
 *   3. The user has an explicit share record granting the required permission.
 */
export function checkAccess(permission: "read" | "write") {
  return createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.get("userId");
    const repoId = c.req.param("repoId");

    if (!repoId) {
      return c.json({ error: "Missing repoId" }, 400);
    }

    const repo = await db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.id, repoId))
      .get();

    if (!repo) {
      return c.json({ error: "Repository not found" }, 404);
    }

    // 1. Direct owner check
    if (repo.ownerType === "user" && repo.ownerUserId === userId) {
      return next();
    }

    // 2. Team member check
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

      if (membership) {
        if (permission === "read") {
          return next();
        }
        // For write, viewer role is insufficient
        if (membership.role !== "viewer") {
          return next();
        }
      }
    }

    // 3. Explicit share check
    // Get the user's email to match share recipients
    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();

    if (user) {
      // Team shares: check if user is in a team that has a share on this repo
      const teamShares = await db
        .select({ permission: schema.shares.permission, teamId: schema.shares.teamId })
        .from(schema.shares)
        .where(
          and(
            eq(schema.shares.repoId, repoId),
            eq(schema.shares.shareType, "team")
          )
        )
        .all();

      for (const ts of teamShares) {
        if (ts.teamId) {
          const membership = await db
            .select()
            .from(schema.teamMembers)
            .where(
              and(
                eq(schema.teamMembers.teamId, ts.teamId),
                eq(schema.teamMembers.userId, userId)
              )
            )
            .get();

          if (membership) {
            if (permission === "read" || ts.permission === "write") {
              return next();
            }
          }
        }
      }

      // Email shares: check shareRecipients for user's email
      const emailShares = await db
        .select({ permission: schema.shares.permission })
        .from(schema.shares)
        .innerJoin(
          schema.shareRecipients,
          eq(schema.shares.id, schema.shareRecipients.shareId)
        )
        .where(
          and(
            eq(schema.shares.repoId, repoId),
            eq(schema.shares.shareType, "email"),
            eq(schema.shareRecipients.email, user.email)
          )
        )
        .all();

      for (const es of emailShares) {
        if (permission === "read" || es.permission === "write") {
          return next();
        }
      }
    }

    return c.json({ error: "Access denied" }, 403);
  });
}
