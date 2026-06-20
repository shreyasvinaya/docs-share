import { Hono, type Context } from "hono";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireScope } from "../middleware/requireScope.js";
import { canReadRepoPath } from "../middleware/shareAccess.js";
import { publicRateLimiter } from "../lib/rateLimiters.js";
import { config } from "../lib/config.js";
import { verifySharePassword } from "../lib/crypto.js";
import {
  normalizeRelativePath,
  resolveInside,
  resolveRealPathInside,
} from "../lib/security.js";
import {
  isHtmlContentType,
  recordViewFromRequest,
  type ViewTargetType,
} from "../services/analytics.js";
import { stat } from "fs/promises";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

/**
 * Records a page view for a successfully served response, fire-and-forget.
 *
 * Only counts genuine page loads: the response must be a 2xx HTML document.
 * Failed/redirect responses and sub-asset requests (css/js/images) are ignored
 * so 404 paths and asset fetches never create view events.
 */
function recordServedView(
  targetType: ViewTargetType,
  targetId: string,
  req: Request,
  response: Response
): void {
  if (!response.ok) return;
  if (!isHtmlContentType(response.headers.get("content-type"))) return;
  recordViewFromRequest(targetType, targetId, req);
}

/**
 * Content types that a browser may interpret as an active (script-capable)
 * document. These are the responses that MUST be served into an opaque origin
 * via a `sandbox` CSP so their inline scripts can never reach the host session
 * cookie or call `/api` with the victim's credentials. Anything else (plain
 * text, raster images, pdf, fonts) is inert and the sandbox is merely harmless.
 */
const ACTIVE_DOCUMENT_CONTENT_TYPES = [
  "text/html",
  "image/svg+xml",
  "application/xhtml+xml",
];

/**
 * Whether a resolved content-type can execute script as a top-level document
 * (HTML / SVG / XHTML). Such responses are served sandboxed (opaque origin).
 */
function isActiveDocumentContentType(contentType: string): boolean {
  const lowered = contentType.trim().toLowerCase();
  return ACTIVE_DOCUMENT_CONTENT_TYPES.some((type) => lowered.startsWith(type));
}

/**
 * CSP applied to user-uploaded documents that can execute script (HTML / SVG /
 * XHTML) served from a repo worktree or a public share.
 *
 * The critical control is `sandbox allow-scripts` (and NEVER `allow-same-origin`):
 * the document runs in an OPAQUE ORIGIN, so even though it is byte-for-byte
 * served from the same host as `/api/*`, its inline scripts cannot read the
 * host `ds_session` cookie, SAME-ORIGIN access the parent window (it may still
 * `postMessage` to it with origin `null`, but the app registers no `message`
 * listeners so nothing acts on it), or issue credentialed `fetch('/api/...')`
 * calls as the victim. `connect-src 'none'` additionally
 * forbids the document from making any network request at all (no
 * exfiltration). `script-src`/`style-src` keep `'self'` so a legitimate
 * multi-file bundle can still load its OWN sibling .js/.css assets (those
 * sub-resource loads are performed by the browser, not by privileged
 * same-origin script, so they continue to work under the sandbox).
 */
const SANDBOXED_DOCUMENT_CSP =
  "sandbox allow-scripts; " +
  "default-src 'none'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "font-src 'self' data:; " +
  "connect-src 'none'; " +
  "base-uri 'none'; " +
  "form-action 'none'";

function securityHeaders(contentType?: string): Record<string, string> {
  const csp =
    contentType && isActiveDocumentContentType(contentType)
      ? SANDBOXED_DOCUMENT_CSP
      : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;";

  return {
    "Content-Security-Policy": csp,
    "X-Frame-Options": "SAMEORIGIN",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // NOTE on Cross-Origin-Resource-Policy: `/view/*` responses MUST carry CORP
    // `cross-origin` (NOT the global `same-origin` default) so the opaque-origin
    // sandboxed documents served here can still load their OWN sibling assets.
    // That override lives in the global `viewAwareSecureHeaders()` middleware,
    // NOT here: Hono's `secureHeaders()` rewrites every managed header AFTER the
    // handler returns, so any CORP set on this Response would be clobbered. See
    // middleware/securityHeaders.ts for the full rationale.
  };
}

function resolveContentType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    xhtml: "application/xhtml+xml; charset=utf-8",
    xht: "application/xhtml+xml; charset=utf-8",
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

/**
 * Whether `userId` may READ `repoId` at the resolved `targetPath` of the
 * request (null/"" = the repo root / whole repo).
 *
 * This is path-aware: the owner and owning-team MEMBERSHIP branches grant
 * whole-repo read, but a team-SHARE or email-SHARE only grants access when its
 * path-scope covers `targetPath` (via {@link shareScopeCovers}). A path-scoped
 * recipient therefore cannot stream worktree files outside their shared path,
 * and a repo-root index (empty target) requires a repo-wide grant.
 */
function userHasAccess(
  userId: string,
  repoId: string,
  targetPath: string | null | undefined
): Promise<boolean> {
  return canReadRepoPath(userId, repoId, targetPath);
}

async function serveFile(
  worktreeBase: string,
  relativePath: string,
  requestPath?: string,
  options: { private?: boolean } = {}
) {
  // Lexical containment first (cheap, rejects `..`/absolute/pathspec-magic),
  // then symlink-aware containment: a symlink materialized inside the worktree
  // passes lexical containment but realpath-resolves to an absolute HOST path
  // (the server .env, the SQLite DB, /etc/passwd, another tenant's worktree).
  // `resolveRealPathInside` denies that, so we 404 instead of streaming it.
  const lexical = resolveInside(worktreeBase, relativePath);
  if (!lexical) {
    return new Response(JSON.stringify({ error: "Invalid path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const resolvedPath = await resolveRealPathInside(worktreeBase, relativePath);
  if (!resolvedPath) {
    return new Response(JSON.stringify({ error: "File not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const fileStat = await stat(resolvedPath);
    if (fileStat.isDirectory()) {
      if (requestPath && !requestPath.endsWith("/")) {
        return Response.redirect(`${requestPath}/`, 308);
      }

      // Prefer index.html, then index.xhtml. Both are active documents that
      // must be served sandboxed (xhtml is in ACTIVE_DOCUMENT_CONTENT_TYPES).
      let indexPath: string | null = null;
      for (const indexName of ["index.html", "index.xhtml"]) {
        const candidate = await resolveRealPathInside(
          worktreeBase,
          relativePath ? `${relativePath}/${indexName}` : indexName
        );
        if (!candidate) continue;
        const candidateStat = await stat(candidate).catch(() => null);
        if (candidateStat?.isFile()) {
          indexPath = candidate;
          break;
        }
      }

      if (!indexPath) {
        return new Response(JSON.stringify({ error: "Directory index not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const indexContentType = resolveContentType(indexPath);
      const headers = securityHeaders(indexContentType);
      headers["Content-Type"] = indexContentType;
      if (options.private) headers["Cache-Control"] = "private, no-store";
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
    const headers = securityHeaders(contentType);
    headers["Content-Type"] = contentType;
    // Authenticated/private repo responses must never be cached by shared
    // proxies or the browser disk cache where another user could retrieve them.
    if (options.private) headers["Cache-Control"] = "private, no-store";

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

  if (!providedPassword || !verifySharePassword(providedPassword, passwordHash)) {
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

  const response = await serveFile(
    worktreeBase,
    resolvedRelativePath,
    c.req.path
  );
  recordServedView("public", share.id, c.req.raw, response);
  return response;
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

  const response = await serveFile(
    worktreeBase,
    normalizedSharePath,
    c.req.path
  );
  recordServedView("public", share.id, c.req.raw, response);
  return response;
});

app.get("/:repoId", requireAuth, requireScope("repo:read"), async (c) => {
  const userId = c.get("userId");
  const repoId = c.req.param("repoId");

  // Whole-repo index: requires a repo-wide read grant (a path-scoped share
  // does not cover the empty/root target).
  const hasAccess = await userHasAccess(userId, repoId, "");
  if (!hasAccess) {
    return c.json({ error: "Access denied" }, 403);
  }

  const worktreeBase = `${config.DATA_DIR}/worktrees/${repoId}`;
  return serveFile(worktreeBase, "", c.req.path, { private: true });
});

/**
 * GET /:repoId/* — Serve actual files from the extracted worktree.
 * Requires auth + access check.
 */
app.get("/:repoId/*", requireAuth, requireScope("repo:read"), async (c) => {
  const userId = c.get("userId");
  const repoId = c.req.param("repoId");
  const viewPrefix = `/view/${repoId}/`;
  const filePath = c.req.path.startsWith(viewPrefix)
    ? c.req.path.slice(viewPrefix.length)
    : "";

  // Path-aware: the specific requested file path must be covered by the read
  // grant; a path-scoped share holder is denied files outside their path.
  const hasAccess = await userHasAccess(userId, repoId, filePath);
  if (!hasAccess) {
    return c.json({ error: "Access denied" }, 403);
  }

  const worktreeBase = `${config.DATA_DIR}/worktrees/${repoId}`;
  return serveFile(worktreeBase, filePath, c.req.path, { private: true });
});

export default app;
