import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { AppEnv } from "../lib/types.js";
import viewRoutes from "./view.js";

// No session middleware → simulates an unauthenticated visitor.
const anonApp = new Hono<AppEnv>();
anonApp.route("/view", viewRoutes);

const cleanup = {
  shareIds: [] as string[],
  repoIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.shareIds.length)
    await db.delete(schema.shares).where(inArray(schema.shares.id, cleanup.shareIds)).run();
  if (cleanup.repoIds.length)
    await db.delete(schema.repos).where(inArray(schema.repos.id, cleanup.repoIds)).run();
  if (cleanup.userIds.length)
    await db.delete(schema.users).where(inArray(schema.users.id, cleanup.userIds)).run();
  cleanup.shareIds = [];
  cleanup.repoIds = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
