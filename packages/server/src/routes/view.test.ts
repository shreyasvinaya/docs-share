import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { mkdir, rm, writeFile } from "fs/promises";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import type { AppEnv } from "../lib/types.js";
import viewRoutes from "./view.js";

// No session middleware → simulates an unauthenticated visitor.
const anonApp = new Hono<AppEnv>();
anonApp.route("/view", viewRoutes);

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
