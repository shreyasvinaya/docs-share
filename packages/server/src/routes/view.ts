import { Hono, type Context } from "hono";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { publicRateLimiter } from "../lib/rateLimiters.js";
import { config } from "../lib/config.js";
import { hashToken } from "../lib/crypto.js";
import { normalizeRelativePath, resolveInside } from "../lib/security.js";
import { stat } from "fs/promises";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

function securityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;",
    "X-Frame-Options": "SAMEORIGIN",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

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
  return ext
    ? mimeMap[ext] ?? "application/octet-stream"
    : "application/octet-stream";
}

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

    if (membership) return true;
  }

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (user) {
    const emailShare = await db
      .select()
      .from(schema.shareRecipients)
      .innerJoin(
        schema.shares,
        eq(schema.shareRecipients.shareId, schema.shares.id)
      )
      .where(
        and(
          eq(schema.shares.repoId, repoId),
          eq(schema.shareRecipients.email, user.email)
        )
      )
      .get();

    if (emailShare) return true;

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

async function serveFile(
  worktreeBase: string,
  relativePath: string,
  requestPath?: string
) {
  const resolvedPath = resolveInside(worktreeBase, relativePath);
  if (!resolvedPath) {
    return new Response(JSON.stringify({ error: "Invalid path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const fileStat = await stat(resolvedPath);
    if (fileStat.isDirectory()) {
      if (requestPath && !requestPath.endsWith("/")) {
        return Response.redirect(`${requestPath}/`, 308);
      }

      const indexPath = resolveInside(
        worktreeBase,
        relativePath ? `${relativePath}/index.html` : "index.html"
      );

      if (!indexPath) {
        return new Response(JSON.stringify({ error: "Invalid path" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const indexStat = await stat(indexPath).catch(() => null);
      if (!indexStat?.isFile()) {
        return new Response(JSON.stringify({ error: "Directory index not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const headers = securityHeaders();
      headers["Content-Type"] = resolveContentType(indexPath);
      return new Response(Bun.file(indexPath), { headers });
    }

    if (!fileStat.isFile()) {
      return new Response(JSON.stringify({ error: "Not a file" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const file = Bun.file(resolvedPath);
    const contentType = resolveContentType(resolvedPath);
    const headers = securityHeaders();
    headers["Content-Type"] = contentType;

    return new Response(file, { headers });
  } catch {
    return new Response(JSON.stringify({ error: "File not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function validateSharePassword(req: Request, passwordHash: string | null): Response | null {
  if (!passwordHash) return null;

  const providedPassword = req.headers.get("X-Share-Password");

  if (!providedPassword || hashToken(providedPassword) !== passwordHash) {
    return new Response(JSON.stringify({ error: "Share password required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}

function joinSharePath(basePath: string | null, childPath: string): string | null {
  const normalizedBase = normalizeRelativePath(basePath);
  const normalizedChild = normalizeRelativePath(childPath);

  if (normalizedBase === null || normalizedChild === null) return null;
  if (!normalizedBase) return normalizedChild;
  if (!normalizedChild) return normalizedBase;
  return `${normalizedBase}/${normalizedChild}`;
}

/**
 * Enforces org-link access. Returns a Response to send immediately when the
 * request is NOT allowed, or null when access is granted.
 *
 * Browser navigations (Accept: text/html) on a denial are redirected to the
 * SPA share-gate page so the visitor sees a friendly screen and can sign in
 * and return here. Non-browser clients keep the JSON 401/403 contract.
 */
async function gateOrgAccess(
  c: Context<AppEnv>,
  share: { linkAccess: string | null; orgDomain: string | null }
): Promise<Response | null> {
  if (share.linkAccess !== "org" || !share.orgDomain) return null;

  const wantsHtml = (c.req.header("Accept") ?? "").includes("text/html");
  const gateUrl =
    `/share-gate?next=${encodeURIComponent(c.req.path)}` +
    `&domain=${encodeURIComponent(share.orgDomain)}`;

  const userId = c.get("userId");
  if (!userId) {
    if (wantsHtml) return c.redirect(gateUrl, 302);
    return c.json(
      {
        error: "Authentication required",
        detail: `This link is restricted to @${share.orgDomain} members. Please sign in.`,
        linkAccess: "org",
        orgDomain: share.orgDomain,
      },
      401
    );
  }

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  const userDomain = user?.email.split("@")[1]?.toLowerCase();
  if (userDomain !== share.orgDomain.toLowerCase()) {
    if (wantsHtml) return c.redirect(gateUrl, 302);
    return c.json(
      {
        error: "Access denied",
        detail: `This link is restricted to @${share.orgDomain} members.`,
        linkAccess: "org",
        orgDomain: share.orgDomain,
      },
      403
    );
  }

  return null;
}

/**
 * GET /public/:token/* — Serve files via public share link.
 * No auth required for "public" links.
 * "org" links require auth + matching email domain.
 */
app.get("/public/:token/*", publicRateLimiter, async (c) => {
  const token = c.req.param("token");
  const publicPrefix = `/view/public/${token}/`;
  const filePath = c.req.path.startsWith(publicPrefix)
    ? c.req.path.slice(publicPrefix.length)
    : "";

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

  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return c.json({ error: "This share link has expired" }, 410);
  }

  const passwordError = validateSharePassword(c.req.raw, share.passwordHash);
  if (passwordError) return passwordError;

  const gate = await gateOrgAccess(c, share);
  if (gate) return gate;

  // Resolve file path: share.path is the base, filePath is relative within it
  // For file shares (share.path = "report.html"), filePath should be empty
  // For directory shares, filePath navigates within
  const worktreeBase = `${config.DATA_DIR}/worktrees/${share.repoId}`;
  const resolvedRelativePath = joinSharePath(share.path, filePath);

  if (resolvedRelativePath === null) {
    return c.json({ error: "Invalid path" }, 400);
  }

  return serveFile(worktreeBase, resolvedRelativePath, c.req.path);
});

/**
 * Also handle /public/:token with no trailing path (for file-level shares).
 */
app.get("/public/:token", publicRateLimiter, async (c) => {
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
    return c.json({ error: "Invalid share link" }, 404);
  }

  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return c.json({ error: "This share link has expired" }, 410);
  }

  const passwordError = validateSharePassword(c.req.raw, share.passwordHash);
  if (passwordError) return passwordError;

  const gate = await gateOrgAccess(c, share);
  if (gate) return gate;

  if (!share.path) {
    return c.json({ error: "No file specified in this share" }, 400);
  }

  const worktreeBase = `${config.DATA_DIR}/worktrees/${share.repoId}`;
  const normalizedSharePath = normalizeRelativePath(share.path);

  if (normalizedSharePath === null) {
    return c.json({ error: "Invalid path" }, 400);
  }

  return serveFile(worktreeBase, normalizedSharePath, c.req.path);
});

app.get("/:repoId", requireAuth, async (c) => {
  const userId = c.get("userId");
  const repoId = c.req.param("repoId");

  const hasAccess = await userHasAccess(userId, repoId);
  if (!hasAccess) {
    return c.json({ error: "Access denied" }, 403);
  }

  const worktreeBase = `${config.DATA_DIR}/worktrees/${repoId}`;
  return serveFile(worktreeBase, "", c.req.path);
});

/**
 * GET /:repoId/* — Serve actual files from the extracted worktree.
 * Requires auth + access check.
 */
app.get("/:repoId/*", requireAuth, async (c) => {
  const userId = c.get("userId");
  const repoId = c.req.param("repoId");
  const viewPrefix = `/view/${repoId}/`;
  const filePath = c.req.path.startsWith(viewPrefix)
    ? c.req.path.slice(viewPrefix.length)
    : "";

  const hasAccess = await userHasAccess(userId, repoId);
  if (!hasAccess) {
    return c.json({ error: "Access denied" }, 403);
  }

  const worktreeBase = `${config.DATA_DIR}/worktrees/${repoId}`;
  return serveFile(worktreeBase, filePath, c.req.path);
});

export default app;
