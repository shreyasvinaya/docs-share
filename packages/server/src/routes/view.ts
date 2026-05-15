import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { config } from "../lib/config.js";
import { join } from "path";
import { stat } from "fs/promises";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

/**
 * Security headers applied to all served content.
 */
function securityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;",
    "X-Frame-Options": "SAMEORIGIN",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

/**
 * Resolve mime type from file extension for serving.
 */
function resolveContentType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    mjs: "application/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    ts: "text/typescript; charset=utf-8",
    tsx: "text/typescript; charset=utf-8",
    jsx: "text/javascript; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    ico: "image/x-icon",
    pdf: "application/pdf",
    zip: "application/zip",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    eot: "application/vnd.ms-fontobject",
    xml: "application/xml; charset=utf-8",
  };
  return ext ? mimeMap[ext] ?? "application/octet-stream" : "application/octet-stream";
}

/**
 * Check if the authenticated user has read access to a repo.
 */
async function userHasAccess(
  userId: string,
  repoId: string
): Promise<boolean> {
  const repo = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, repoId))
    .get();

  if (!repo) return false;

  // Direct owner
  if (repo.ownerType === "user" && repo.ownerUserId === userId) {
    return true;
  }

  // Team member
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

    if (membership) return true;
  }

  // Email share
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (user) {
    const emailShare = await db
      .select()
      .from(schema.shareRecipients)
      .innerJoin(schema.shares, eq(schema.shareRecipients.shareId, schema.shares.id))
      .where(
        and(
          eq(schema.shares.repoId, repoId),
          eq(schema.shareRecipients.email, user.email)
        )
      )
      .get();

    if (emailShare) return true;

    // Team share
    const teamShares = await db
      .select({ teamId: schema.shares.teamId })
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

        if (membership) return true;
      }
    }
  }

  return false;
}

/**
 * GET /public/:token/* — Serve files via public share link.
 * No auth required. Validates token and checks expiry.
 */
app.get("/public/:token/*", async (c) => {
  const token = c.req.param("token");
  const filePath = c.req.path.replace(`/public/${token}/`, "").replace(/^\//, "");

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
    return c.json({ error: "Invalid share link" }, 404);
  }

  // Check expiry
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return c.json({ error: "This share link has expired" }, 410);
  }

  // Resolve the file on disk
  const resolvedPath = share.path
    ? join(config.DATA_DIR, "worktrees", share.repoId, share.path, filePath)
    : join(config.DATA_DIR, "worktrees", share.repoId, filePath);

  // Prevent path traversal
  const worktreeBase = join(config.DATA_DIR, "worktrees", share.repoId);
  if (!resolvedPath.startsWith(worktreeBase)) {
    return c.json({ error: "Invalid path" }, 400);
  }

  try {
    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) {
      return c.json({ error: "Not a file" }, 404);
    }

    const file = Bun.file(resolvedPath);
    const contentType = resolveContentType(resolvedPath);
    const headers = securityHeaders();
    headers["Content-Type"] = contentType;

    return new Response(file, { headers });
  } catch {
    return c.json({ error: "File not found" }, 404);
  }
});

/**
 * GET /:repoId/* — Serve actual files from the extracted worktree.
 * Requires auth + access check.
 */
app.get("/:repoId/*", requireAuth, async (c) => {
  const userId = c.get("userId");
  const repoId = c.req.param("repoId");
  const filePath = c.req.path.replace(`/${repoId}/`, "").replace(/^\//, "");

  // Check access
  const hasAccess = await userHasAccess(userId, repoId);
  if (!hasAccess) {
    return c.json({ error: "Access denied" }, 403);
  }

  // Resolve the file on disk from the worktree
  const resolvedPath = join(config.DATA_DIR, "worktrees", repoId, filePath);

  // Prevent path traversal
  const worktreeBase = join(config.DATA_DIR, "worktrees", repoId);
  if (!resolvedPath.startsWith(worktreeBase)) {
    return c.json({ error: "Invalid path" }, 400);
  }

  try {
    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) {
      return c.json({ error: "Not a file" }, 404);
    }

    const file = Bun.file(resolvedPath);
    const contentType = resolveContentType(resolvedPath);
    const headers = securityHeaders();
    headers["Content-Type"] = contentType;

    return new Response(file, { headers });
  } catch {
    return c.json({ error: "File not found" }, 404);
  }
});

export default app;
