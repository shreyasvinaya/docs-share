import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { recordViewEvent } from "../services/analytics.js";
import type { AppEnv } from "../lib/types.js";
import shareRoutes from "./shares.js";

const cleanup = {
  viewTargets: [] as string[],
  shareIds: [] as string[],
  repoIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.viewTargets.length)
    await db
      .delete(schema.viewEvents)
      .where(inArray(schema.viewEvents.targetId, cleanup.viewTargets))
      .run();
  if (cleanup.shareIds.length)
    await db
      .delete(schema.shares)
      .where(inArray(schema.shares.id, cleanup.shareIds))
      .run();
  if (cleanup.repoIds.length)
    await db
      .delete(schema.repos)
      .where(inArray(schema.repos.id, cleanup.repoIds))
      .run();
  if (cleanup.userIds.length)
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, cleanup.userIds))
      .run();
  cleanup.viewTargets = [];
  cleanup.shareIds = [];
  cleanup.repoIds = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function appAs(userId: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    c.set("authMethod", "session");
    return next();
  });
  app.route("/api/shares", shareRoutes);
  return app;
}

async function seedPublicShare(): Promise<{ ownerId: string; shareId: string }> {
  const ownerId = testId("user");
  const repoId = testId("repo");
  const shareId = testId("share");

  await db.insert(schema.users).values({
    id: ownerId,
    email: `${ownerId}@example.com`,
    displayName: "Owner",
    googleId: `g_${ownerId}`,
  });
  await db.insert(schema.repos).values({
    id: repoId,
    ownerType: "user",
    ownerUserId: ownerId,
    diskPath: `/tmp/${repoId}.git`,
  });
  await db.insert(schema.shares).values({
    id: shareId,
    repoId,
    path: "index.html",
    createdById: ownerId,
    shareType: "public_link",
    publicToken: testId("tok"),
  });

  cleanup.userIds.push(ownerId);
  cleanup.repoIds.push(repoId);
  cleanup.shareIds.push(shareId);
  cleanup.viewTargets.push(shareId);
  return { ownerId, shareId };
}

describe("GET /api/shares/:shareId/analytics", () => {
  test("returns view stats to the share creator", async () => {
    const { ownerId, shareId } = await seedPublicShare();

    await recordViewEvent({
      targetType: "public",
      targetId: shareId,
      ip: "1.1.1.1",
      userAgent: "A",
      referrer: "https://ref.example.com",
    });
    await recordViewEvent({
      targetType: "public",
      targetId: shareId,
      ip: "1.1.1.1",
      userAgent: "A",
      referrer: "https://ref.example.com",
    });
    await recordViewEvent({
      targetType: "public",
      targetId: shareId,
      ip: "2.2.2.2",
      userAgent: "B",
      referrer: null,
    });

    const res = await appAs(ownerId).request(
      `/api/shares/${shareId}/analytics`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        totalViews: number;
        uniqueVisitors: number;
        recentReferrers: string[];
      };
    };
    expect(body.data.totalViews).toBe(3);
    expect(body.data.uniqueVisitors).toBe(2);
    expect(body.data.recentReferrers).toContain("https://ref.example.com");
  });

  test("forbids non-creators", async () => {
    const { shareId } = await seedPublicShare();
    const intruderId = testId("user");
    await db.insert(schema.users).values({
      id: intruderId,
      email: `${intruderId}@example.com`,
      displayName: "Intruder",
      googleId: `g_${intruderId}`,
    });
    cleanup.userIds.push(intruderId);

    const res = await appAs(intruderId).request(
      `/api/shares/${shareId}/analytics`
    );
    expect(res.status).toBe(403);
  });

  test("404s for an unknown share", async () => {
    const ownerId = testId("user");
    await db.insert(schema.users).values({
      id: ownerId,
      email: `${ownerId}@example.com`,
      displayName: "Owner",
      googleId: `g_${ownerId}`,
    });
    cleanup.userIds.push(ownerId);

    const res = await appAs(ownerId).request(
      `/api/shares/${testId("missing")}/analytics`
    );
    expect(res.status).toBe(404);
  });
});
