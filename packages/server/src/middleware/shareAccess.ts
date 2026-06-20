import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { normalizeRelativePath } from "../lib/security.js";
import type { AppEnv } from "../lib/types.js";

/**
 * Whether a share whose scope is `sharePath` (null = whole repo) covers the
 * `targetPath` of a request (null/"" = whole repo).
 *
 * Rules:
 *   - A whole-repo share (sharePath null/empty) covers any target.
 *   - A path-scoped share covers a target that equals its path or lives under
 *     it (i.e. `targetPath === sharePath` or starts with `sharePath + "/"`).
 *   - A path-scoped share NEVER covers a whole-repo target (targetPath empty),
 *     so a path-scoped writer cannot escalate to a repo-wide operation.
 *
 * Both inputs are normalized through {@link normalizeRelativePath}; a path that
 * fails normalization (traversal, absolute, etc.) is treated as not covering.
 */
export function shareScopeCovers(
  sharePath: string | null | undefined,
  targetPath: string | null | undefined
): boolean {
  const scope = normalizeRelativePath(sharePath ?? "");
  if (scope === null) return false;
  // Whole-repo share covers everything.
  if (scope === "") return true;

  const target = normalizeRelativePath(targetPath ?? "");
  if (target === null) return false;
  // Whole-repo target requires a whole-repo grant, which this is not.
  if (target === "") return false;

  return target === scope || target.startsWith(`${scope}/`);
}

/**
 * Whether `userId` may access `repoId` at `targetPath` (null/"" = whole repo)
 * with the given `permission`, taking share path-scopes into account.
 *
 * Grants when any of the following hold:
 *   1. Direct owner of the repo.
 *   2. Team member of the owning team (any role for read; non-viewer for write).
 *   3. A team or email share on the repo whose permission satisfies the request
 *      AND whose path-scope covers `targetPath` (see {@link shareScopeCovers}).
 *
 * This is the path-aware counterpart of {@link checkAccess}; lifecycle
 * endpoints (restore/copy) use it so a path-scoped write share cannot authorize
 * writes outside its path, and a whole-repo operation requires a repo-wide
 * grant.
 */
export async function canAccessRepoPath(
  userId: string,
  repoId: string,
  permission: "read" | "write",
  targetPath: string | null | undefined
): Promise<boolean> {
  const repo = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, repoId))
    .get();
  if (!repo) return false;

  // 1. Direct owner.
  if (repo.ownerType === "user" && repo.ownerUserId === userId) return true;

  // 2. Owning-team membership.
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
      if (permission === "read") return true;
      if (membership.role !== "viewer") return true;
    }
  }

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user) return false;

  // 3a. Team shares the user belongs to.
  const teamShares = await db
    .select({
      permission: schema.shares.permission,
      teamId: schema.shares.teamId,
      path: schema.shares.path,
    })
    .from(schema.shares)
    .where(
      and(eq(schema.shares.repoId, repoId), eq(schema.shares.shareType, "team"))
    )
    .all();

  for (const ts of teamShares) {
    if (!ts.teamId) continue;
    if (permission === "write" && ts.permission !== "write") continue;
    if (!shareScopeCovers(ts.path, targetPath)) continue;
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
    if (membership) return true;
  }

  // 3b. Email shares addressed to the user's email.
  const emailShares = await db
    .select({
      permission: schema.shares.permission,
      path: schema.shares.path,
    })
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
    if (permission === "write" && es.permission !== "write") continue;
    if (shareScopeCovers(es.path, targetPath)) return true;
  }

  return false;
}

/**
 * Whether `userId` may WRITE to `repoId` at `targetPath` (null/"" = whole repo).
 * A whole-repo write requires a repo-wide grant (owner, non-viewer team member,
 * or a write share with no path scope); a path-scoped write share only
 * authorizes writes within its path.
 */
export function canWriteRepoPath(
  userId: string,
  repoId: string,
  targetPath: string | null | undefined
): Promise<boolean> {
  return canAccessRepoPath(userId, repoId, "write", targetPath);
}

/**
 * Whether `userId` may READ `repoId` at `targetPath` (null/"" = whole repo).
 */
export function canReadRepoPath(
  userId: string,
  repoId: string,
  targetPath: string | null | undefined
): Promise<boolean> {
  return canAccessRepoPath(userId, repoId, "read", targetPath);
}

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
