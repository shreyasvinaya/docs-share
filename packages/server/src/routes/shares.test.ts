import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { AppEnv } from "../lib/types.js";
import shareRoutes from "./shares.js";

const cleanup = {
  recipientIds: [] as string[],
  shareIds: [] as string[],
  repoIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.recipientIds.length)
    await db.delete(schema.shareRecipients).where(inArray(schema.shareRecipients.id, cleanup.recipientIds)).run();
  if (cleanup.shareIds.length)
    await db.delete(schema.shares).where(inArray(schema.shares.id, cleanup.shareIds)).run();
  if (cleanup.repoIds.length)
    await db.delete(schema.repos).where(inArray(schema.repos.id, cleanup.repoIds)).run();
  if (cleanup.userIds.length)
    await db.delete(schema.users).where(inArray(schema.users.id, cleanup.userIds)).run();
  cleanup.recipientIds = [];
  cleanup.shareIds = [];
  cleanup.repoIds = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function appAs(userId: string) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    return next();
  });
  app.route("/api/shares", shareRoutes);
  return app;
}

async function seedEmailShare() {
  const ownerId = testId("owner");
  const recipientUserId = testId("recipient");
  const recipientEmail = `${recipientUserId}@example.com`;
  const repoId = testId("repo");
  const shareId = testId("share");
  const recipientId = testId("rcpt");

  await db.insert(schema.users).values([
    { id: ownerId, email: `${ownerId}@example.com`, displayName: "Owner", googleId: `g_${ownerId}` },
    { id: recipientUserId, email: recipientEmail, displayName: "Recipient", googleId: `g_${recipientUserId}` },
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
    createdById: ownerId,
    shareType: "email",
    permission: "read",
  });
  await db.insert(schema.shareRecipients).values({
    id: recipientId,
    shareId,
    email: recipientEmail,
    userId: null,
  });

  cleanup.userIds.push(ownerId, recipientUserId);
  cleanup.repoIds.push(repoId);
  cleanup.shareIds.push(shareId);
  cleanup.recipientIds.push(recipientId);
  return { ownerId, recipientUserId, recipientEmail, shareId, recipientId };
}

describe("POST /api/shares/:shareId/accept", () => {
  test("stamps acceptedAt and links the recipient to the user", async () => {
    const { recipientUserId, shareId, recipientId } = await seedEmailShare();

    const res = await appAs(recipientUserId).request(
      `/api/shares/${shareId}/accept`,
      { method: "POST" }
    );
    expect(res.status).toBe(200);

    const recipient = await db
      .select()
      .from(schema.shareRecipients)
      .where(eq(schema.shareRecipients.id, recipientId))
      .get();
    expect(recipient?.acceptedAt).toBeTruthy();
    expect(recipient?.userId).toBe(recipientUserId);
  });

  test("is idempotent — keeps the original acceptedAt on repeat accept", async () => {
    const { recipientUserId, shareId, recipientId } = await seedEmailShare();

    const first = await appAs(recipientUserId).request(
      `/api/shares/${shareId}/accept`,
      { method: "POST" }
    );
    expect(first.status).toBe(200);
    const firstRow = await db
      .select()
      .from(schema.shareRecipients)
      .where(eq(schema.shareRecipients.id, recipientId))
      .get();
    const firstAcceptedAt = firstRow?.acceptedAt;

    const second = await appAs(recipientUserId).request(
      `/api/shares/${shareId}/accept`,
      { method: "POST" }
    );
    expect(second.status).toBe(200);
    const secondRow = await db
      .select()
      .from(schema.shareRecipients)
      .where(eq(schema.shareRecipients.id, recipientId))
      .get();
    expect(secondRow?.acceptedAt).toBe(firstAcceptedAt!);
  });

  test("returns 404 when the user is not a recipient", async () => {
    const { shareId } = await seedEmailShare();
    const strangerId = testId("stranger");
    await db.insert(schema.users).values({
      id: strangerId,
      email: `${strangerId}@example.com`,
      displayName: "Stranger",
      googleId: `g_${strangerId}`,
    });
    cleanup.userIds.push(strangerId);

    const res = await appAs(strangerId).request(
      `/api/shares/${shareId}/accept`,
      { method: "POST" }
    );
    expect(res.status).toBe(404);
  });
});
