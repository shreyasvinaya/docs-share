import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { mkdir, rm, writeFile } from "fs/promises";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { viewAwareSecureHeaders } from "../middleware/securityHeaders.js";
import type { AppEnv } from "../lib/types.js";
import viewRoutes from "./view.js";

// No session middleware → simulates an unauthenticated visitor.
const anonApp = new Hono<AppEnv>();
anonApp.route("/view", viewRoutes);

/**
 * App built the way `index.ts` builds it: the SAME global security-headers
 * middleware (`viewAwareSecureHeaders`) runs ahead of the mounted `/view`
 * routes. This is the only stack that exercises the interaction between the
 * global `secureHeaders()` (which rewrites every header AFTER the handler
 * returns and would otherwise clobber CORP back to `same-origin`) and the
 * `/view` routes, so the CORP regression (sandboxed opaque-origin docs must
 * still be able to load their own sibling assets) is only catchable here, not
 * in a route-only app.
 */
const fullStackApp = new Hono<AppEnv>();
fullStackApp.use("*", viewAwareSecureHeaders());
fullStackApp.route("/view", viewRoutes);

const cleanup = {
  shareIds: [] as string[],
  repoIds: [] as string[],
  userIds: [] as string[],
  viewTargets: [] as string[],
  worktreeDirs: [] as string[],
};

afterEach(async () => {
  if (cleanup.viewTargets.length)
    await db
      .delete(schema.viewEvents)
      .where(inArray(schema.viewEvents.targetId, cleanup.viewTargets))
      .run();
  if (cleanup.shareIds.length)
    await db.delete(schema.shares).where(inArray(schema.shares.id, cleanup.shareIds)).run();
  if (cleanup.repoIds.length)
    await db.delete(schema.repos).where(inArray(schema.repos.id, cleanup.repoIds)).run();
  if (cleanup.userIds.length)
    await db.delete(schema.users).where(inArray(schema.users.id, cleanup.userIds)).run();
  for (const dir of cleanup.worktreeDirs)
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  cleanup.shareIds = [];
  cleanup.repoIds = [];
  cleanup.userIds = [];
  cleanup.viewTargets = [];
  cleanup.worktreeDirs = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function countViews(targetId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.viewEvents.id })
    .from(schema.viewEvents)
    .where(eq(schema.viewEvents.targetId, targetId))
    .all();
  return rows.length;
}

/**
 * Records are written fire-and-forget; give the async insert a few ticks to
 * land, then read the resulting count.
 */
async function viewCountAfterSettle(targetId: string): Promise<number> {
  for (let i = 0; i < 25; i++) {
    if ((await countViews(targetId)) > 0) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  return countViews(targetId);
}

async function seedOrgShare(orgDomain: string): Promise<{ token: string }> {
  const userId = testId("user");
  const repoId = testId("repo");
  const shareId = testId("share");
  const token = testId("tok");

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: "Owner",
    googleId: `g_${userId}`,
  });
  await db.insert(schema.repos).values({
    id: repoId,
    ownerType: "user",
    ownerUserId: userId,
    diskPath: `/tmp/${repoId}.git`,
  });
  await db.insert(schema.shares).values({
    id: shareId,
    repoId,
    path: "index.html",
    createdById: userId,
    shareType: "public_link",
    publicToken: token,
    linkAccess: "org",
    orgDomain,
  });

  cleanup.userIds.push(userId);
  cleanup.repoIds.push(repoId);
  cleanup.shareIds.push(shareId);
  return { token };
}

async function seedPublicShareWithFiles(): Promise<{
  token: string;
  shareId: string;
}> {
  const userId = testId("user");
  const repoId = testId("repo");
  const shareId = testId("share");
  const token = testId("tok");

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: "Owner",
    googleId: `g_${userId}`,
  });
  await db.insert(schema.repos).values({
    id: repoId,
    ownerType: "user",
    ownerUserId: userId,
    diskPath: `/tmp/${repoId}.git`,
  });
  await db.insert(schema.shares).values({
    id: shareId,
    repoId,
    // Directory share so we can serve both an HTML page and a CSS asset.
    path: null,
    createdById: userId,
    shareType: "public_link",
    publicToken: token,
    linkAccess: "public",
  });

  const worktreeBase = `${config.DATA_DIR}/worktrees/${repoId}`;
  await mkdir(worktreeBase, { recursive: true });
  await writeFile(`${worktreeBase}/index.html`, "<html><body>hi</body></html>");
  await writeFile(`${worktreeBase}/styles.css`, "body { color: red; }");

  cleanup.userIds.push(userId);
  cleanup.repoIds.push(repoId);
  cleanup.shareIds.push(shareId);
  cleanup.viewTargets.push(shareId);
  cleanup.worktreeDirs.push(worktreeBase);
  return { token, shareId };
}

/**
 * Seed a public share over a directory worktree that contains a multi-file
 * bundle: an HTML page that links a sibling .css/.js, plus a standalone .svg.
 * Lets us assert both the sandbox CSP on active documents and that inert
 * sibling assets still resolve.
 */
async function seedPublicShareBundle(): Promise<{
  token: string;
  shareId: string;
}> {
  const userId = testId("user");
  const repoId = testId("repo");
  const shareId = testId("share");
  const token = testId("tok");

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: "Owner",
    googleId: `g_${userId}`,
  });
  await db.insert(schema.repos).values({
    id: repoId,
    ownerType: "user",
    ownerUserId: userId,
    diskPath: `/tmp/${repoId}.git`,
  });
  await db.insert(schema.shares).values({
    id: shareId,
    repoId,
    path: null,
    createdById: userId,
    shareType: "public_link",
    publicToken: token,
    linkAccess: "public",
  });

  const worktreeBase = `${config.DATA_DIR}/worktrees/${repoId}`;
  await mkdir(worktreeBase, { recursive: true });
  await writeFile(
    `${worktreeBase}/index.html`,
    `<!doctype html><html><head><link rel="stylesheet" href="app.css"><script src="app.js"></script></head><body>hi</body></html>`
  );
  await writeFile(`${worktreeBase}/app.css`, "body { color: red; }");
  await writeFile(`${worktreeBase}/app.js`, "console.log('hi');");
  await writeFile(
    `${worktreeBase}/logo.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`
  );
  await writeFile(
    `${worktreeBase}/page.xhtml`,
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>hi</body></html>`
  );
  // A directory whose only index is an .xhtml document (directory-index path).
  await mkdir(`${worktreeBase}/sub`, { recursive: true });
  await writeFile(
    `${worktreeBase}/sub/index.xhtml`,
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>sub</body></html>`
  );

  cleanup.userIds.push(userId);
  cleanup.repoIds.push(repoId);
  cleanup.shareIds.push(shareId);
  cleanup.viewTargets.push(shareId);
  cleanup.worktreeDirs.push(worktreeBase);
  return { token, shareId };
}

/**
 * Seed a repo whose worktree has docs/page.html and root.html, and grant
 * `recipientEmail`'s user a READ share scoped to `sharePath` (null = whole repo).
 * Returns the repoId and the recipient userId.
 */
async function seedRepoWithScopedReadShare(sharePath: string | null): Promise<{
  repoId: string;
  recipientId: string;
}> {
  const ownerId = testId("owner");
  const recipientId = testId("recipient");
  const repoId = testId("repo");
  const shareId = testId("share");

  await db.insert(schema.users).values([
    {
      id: ownerId,
      email: `${ownerId}@example.com`,
      displayName: "Owner",
      googleId: `g_${ownerId}`,
    },
    {
      id: recipientId,
      email: `${recipientId}@example.com`,
      displayName: "Recipient",
      googleId: `g_${recipientId}`,
    },
  ]);
  await db.insert(schema.repos).values({
    id: repoId,
    ownerType: "user",
    ownerUserId: ownerId,
    diskPath: `/tmp/${repoId}.git`,
  });
  await db.insert(schema.shares).values({
    id: shareId,
    repoId,
    path: sharePath,
    createdById: ownerId,
    shareType: "email",
    permission: "read",
  });
  await db.insert(schema.shareRecipients).values({
    id: testId("rcp"),
    shareId,
    email: `${recipientId}@example.com`,
    userId: recipientId,
  });

  const worktreeBase = `${config.DATA_DIR}/worktrees/${repoId}`;
  await mkdir(`${worktreeBase}/docs`, { recursive: true });
  await writeFile(`${worktreeBase}/docs/page.html`, "<html>docs</html>");
  await writeFile(`${worktreeBase}/root.html`, "<html>root</html>");
  await writeFile(
    `${worktreeBase}/page.xhtml`,
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>root</body></html>`
  );

  cleanup.userIds.push(ownerId, recipientId);
  cleanup.repoIds.push(repoId);
  cleanup.shareIds.push(shareId);
  cleanup.worktreeDirs.push(worktreeBase);
  return { repoId, recipientId };
}

function authedAppAs(userId: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    return next();
  });
  app.route("/view", viewRoutes);
  return app;
}

describe("path-scoped share authorization on view serving", () => {
  test("path-scoped reader can read a file within their path", async () => {
    const { repoId, recipientId } = await seedRepoWithScopedReadShare("docs");
    const res = await authedAppAs(recipientId).request(
      `/view/${repoId}/docs/page.html`
    );
    expect(res.status).toBe(200);
  });

  test("path-scoped reader is denied a file outside their path", async () => {
    const { repoId, recipientId } = await seedRepoWithScopedReadShare("docs");
    const res = await authedAppAs(recipientId).request(
      `/view/${repoId}/root.html`
    );
    expect(res.status).toBe(403);
  });

  test("path-scoped reader is denied the whole-repo index", async () => {
    const { repoId, recipientId } = await seedRepoWithScopedReadShare("docs");
    const res = await authedAppAs(recipientId).request(`/view/${repoId}`);
    expect(res.status).toBe(403);
  });

  test("whole-repo reader can read any file and the index", async () => {
    const { repoId, recipientId } = await seedRepoWithScopedReadShare(null);

    const outside = await authedAppAs(recipientId).request(
      `/view/${repoId}/root.html`
    );
    expect(outside.status).toBe(200);

    const inside = await authedAppAs(recipientId).request(
      `/view/${repoId}/docs/page.html`
    );
    expect(inside.status).toBe(200);
  });
});

describe("public view recording", () => {
  test("records a view when an HTML page is served", async () => {
    const { token, shareId } = await seedPublicShareWithFiles();

    const res = await anonApp.request(`/view/public/${token}/index.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    expect(await viewCountAfterSettle(shareId)).toBe(1);
  });

  test("does not record a view for a sub-asset (css) request", async () => {
    const { token, shareId } = await seedPublicShareWithFiles();

    const res = await anonApp.request(`/view/public/${token}/styles.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");

    // Give any (incorrect) async write a chance to land, then assert none did.
    await new Promise((r) => setTimeout(r, 60));
    expect(await countViews(shareId)).toBe(0);
  });

  test("does not record a view for a 404 (missing file) request", async () => {
    const { token, shareId } = await seedPublicShareWithFiles();

    const res = await anonApp.request(`/view/public/${token}/missing.html`);
    expect(res.status).toBe(404);

    await new Promise((r) => setTimeout(r, 60));
    expect(await countViews(shareId)).toBe(0);
  });

  test("dedupes repeat HTML views from the same visitor", async () => {
    const { token, shareId } = await seedPublicShareWithFiles();

    await anonApp.request(`/view/public/${token}/index.html`);
    expect(await viewCountAfterSettle(shareId)).toBe(1);

    // Same visitor (no IP/UA headers change) within the window: still 1.
    await anonApp.request(`/view/public/${token}/index.html`);
    await new Promise((r) => setTimeout(r, 60));
    expect(await countViews(shareId)).toBe(1);
  });
});

describe("org-restricted public link gate", () => {
  test("redirects browser navigations to the share-gate page", async () => {
    const { token } = await seedOrgShare("acme.com");
    const res = await anonApp.request(`/view/public/${token}`, {
      headers: { Accept: "text/html" },
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/share-gate");
    expect(location).toContain(`next=${encodeURIComponent(`/view/public/${token}`)}`);
    expect(location).toContain("domain=acme.com");
  });

  test("keeps JSON 401 for non-browser clients", async () => {
    const { token } = await seedOrgShare("acme.com");
    const res = await anonApp.request(`/view/public/${token}`, {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; orgDomain: string };
    expect(body.error).toBe("Authentication required");
    expect(body.orgDomain).toBe("acme.com");
  });

  test("redirects a signed-in wrong-domain visitor to the gate (browser)", async () => {
    const { token } = await seedOrgShare("acme.com");
    const outsiderId = testId("user");
    await db.insert(schema.users).values({
      id: outsiderId,
      email: `${outsiderId}@gmail.com`,
      displayName: "Outsider",
      googleId: `g_${outsiderId}`,
    });
    cleanup.userIds.push(outsiderId);

    const authedApp = new Hono<AppEnv>();
    authedApp.use("*", async (c, next) => {
      c.set("userId", outsiderId);
      return next();
    });
    authedApp.route("/view", viewRoutes);

    const res = await authedApp.request(`/view/public/${token}`, {
      headers: { Accept: "text/html" },
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/share-gate");
    expect(location).toContain(`next=${encodeURIComponent(`/view/public/${token}`)}`);
    expect(location).toContain("domain=acme.com");
  });
});

describe("served-document sandbox isolation (XSS containment)", () => {
  test("HTML responses are served into an opaque origin via sandbox CSP", async () => {
    const { token } = await seedPublicShareBundle();
    const res = await anonApp.request(`/view/public/${token}/index.html`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const csp = res.headers.get("content-security-policy") ?? "";
    // Opaque-origin sandbox is the critical control: scripts may run, but the
    // document can never act with the host's same-origin privileges.
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    // The document cannot make ANY network request, so it cannot reach the API
    // origin (no credentialed fetch('/api/...'), no exfiltration).
    expect(csp).toContain("connect-src 'none'");
    // nosniff is retained.
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("SVG responses are sandboxed too (SVG can carry inline script)", async () => {
    const { token } = await seedPublicShareBundle();
    const res = await anonApp.request(`/view/public/${token}/logo.svg`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");

    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("connect-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("inert sibling assets in a bundle still resolve and are NOT sandboxed", async () => {
    const { token } = await seedPublicShareBundle();

    // A linked stylesheet sibling still loads under the sandbox (the browser,
    // not privileged script, fetches it).
    const css = await anonApp.request(`/view/public/${token}/app.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(css.headers.get("content-security-policy") ?? "").not.toContain(
      "sandbox"
    );

    // A linked script sibling still loads as well.
    const js = await anonApp.request(`/view/public/${token}/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("application/javascript");
    expect(js.headers.get("content-security-policy") ?? "").not.toContain(
      "sandbox"
    );
  });

  test("authenticated repo HTML views are sandboxed too", async () => {
    const { repoId, recipientId } = await seedRepoWithScopedReadShare(null);
    const res = await authedAppAs(recipientId).request(
      `/view/${repoId}/root.html`
    );

    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("connect-src 'none'");
  });
});

describe("xhtml documents are treated as active documents (sandboxed)", () => {
  test("public .xhtml is served as application/xhtml+xml and sandboxed", async () => {
    const { token } = await seedPublicShareBundle();
    const res = await anonApp.request(`/view/public/${token}/page.xhtml`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xhtml+xml");

    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("connect-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("authenticated repo .xhtml is sandboxed", async () => {
    const { repoId, recipientId } = await seedRepoWithScopedReadShare(null);
    const res = await authedAppAs(recipientId).request(
      `/view/${repoId}/page.xhtml`
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xhtml+xml");

    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("connect-src 'none'");
  });

  test("directory-index .xhtml (index.xhtml) is served and sandboxed", async () => {
    const { token } = await seedPublicShareBundle();
    // Request the directory; serveFile resolves its index.xhtml.
    const res = await anonApp.request(`/view/public/${token}/sub/`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xhtml+xml");

    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("connect-src 'none'");
  });
});

describe("full middleware stack: CORP lets opaque-origin bundles load siblings", () => {
  test("served .html is sandboxed AND carries CORP cross-origin (overriding global same-origin)", async () => {
    const { token } = await seedPublicShareBundle();
    const res = await fullStackApp.request(`/view/public/${token}/index.html`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    // Sandbox containment still holds through the real middleware stack.
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");

    // The document is an opaque origin, so its OWN siblings are cross-origin
    // relative to it. CORP must be `cross-origin` (NOT the global
    // `same-origin`) or the browser blocks the bundle's assets in production.
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });

  test("sibling .js is served with CORP cross-origin so the opaque-origin doc can load it", async () => {
    const { token } = await seedPublicShareBundle();
    const res = await fullStackApp.request(`/view/public/${token}/app.js`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });

  test("sibling .css is served with CORP cross-origin so the opaque-origin doc can load it", async () => {
    const { token } = await seedPublicShareBundle();
    const res = await fullStackApp.request(`/view/public/${token}/app.css`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });
});
