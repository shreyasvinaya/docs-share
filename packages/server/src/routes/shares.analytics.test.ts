import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { recordViewEvent } from "../services/analytics.js";
import type { AppEnv } from "../lib/types.js";
import shareRoutes from "./shares.js";

const cleanup = {
  viewTargets: [] as string[],
  shareIds: [] as string[],
  repoIds: [] as string[],
  userIds: [] as string[],
  auditTargets: [] as string[],
};

afterEach(async () => {
  if (cleanup.viewTargets.length)
    await db
      .delete(schema.viewEvents)
      .where(inArray(schema.viewEvents.targetId, cleanup.viewTargets))
      .run();
  if (cleanup.auditTargets.length)
    await db
      .delete(schema.auditLog)
      .where(inArray(schema.auditLog.targetId, cleanup.auditTargets))
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
  cleanup.auditTargets = [];
});

async function waitForAuditEntry(
  targetId: string,
  attempts = 50
): Promise<typeof schema.auditLog.$inferSelect | undefined> {
  for (let i = 0; i < attempts; i++) {
    const row = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, targetId))
      .get();
    if (row) return row;
    await new Promise((r) => setTimeout(r, 10));
  }
  return undefined;
}

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

describe("email-share audit metadata", () => {
  test("records recipientCount, never raw email addresses", async () => {
    const ownerId = testId("user");
    const repoId = testId("repo");

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
    cleanup.userIds.push(ownerId);
    cleanup.repoIds.push(repoId);

    const emails = ["alice@secret.example", "bob@secret.example"];
    const res = await appAs(ownerId).request("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoId,
        path: "index.html",
        shareType: "email",
        permission: "read",
        emails,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    const shareId = body.data.id;
    cleanup.shareIds.push(shareId);
    cleanup.viewTargets.push(shareId);
    cleanup.auditTargets.push(shareId);

    const auditRow = await waitForAuditEntry(shareId);
    expect(auditRow).toBeDefined();
    expect(auditRow?.action).toBe("share.created");

    const metadataRaw = auditRow?.metadata ?? "{}";
    const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
    expect(metadata.recipientCount).toBe(emails.length);
    expect(metadata).not.toHaveProperty("recipients");

    // Defense-in-depth: no raw email address leaks into the serialized metadata.
    for (const email of emails) {
      expect(metadataRaw).not.toContain(email);
    }
  });
});
