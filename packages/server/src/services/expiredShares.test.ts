import { afterEach, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { sweepExpiredShares } from "./expiredShares.js";

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

async function seedShare(expiresAt: string | null): Promise<string> {
  const userId = testId("user");
  const repoId = testId("repo");
  const shareId = testId("share");

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: "User",
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
    createdById: userId,
    shareType: "public_link",
    publicToken: testId("tok"),
    expiresAt,
  });

  cleanup.userIds.push(userId);
  cleanup.repoIds.push(repoId);
  cleanup.shareIds.push(shareId);
  return shareId;
}

describe("sweepExpiredShares", () => {
  test("deletes only shares whose expiresAt has passed", async () => {
    const now = new Date("2026-06-20T12:00:00.000Z");
    const expiredId = await seedShare("2026-06-20T11:59:59.000Z");
    const futureId = await seedShare("2026-06-20T12:00:01.000Z");
    const neverId = await seedShare(null);

    const deleted = await sweepExpiredShares(now);

    expect(deleted).toContain(expiredId);
    expect(deleted).not.toContain(futureId);
    expect(deleted).not.toContain(neverId);

    const remaining = await db
      .select({ id: schema.shares.id })
      .from(schema.shares)
      .where(inArray(schema.shares.id, [expiredId, futureId, neverId]))
      .all();
    const remainingIds = remaining.map((r) => r.id);
    expect(remainingIds).not.toContain(expiredId);
    expect(remainingIds).toContain(futureId);
    expect(remainingIds).toContain(neverId);
  });

  test("treats a share expiring exactly at now as expired", async () => {
    const now = new Date("2026-06-20T12:00:00.000Z");
    const exactId = await seedShare("2026-06-20T12:00:00.000Z");

    const deleted = await sweepExpiredShares(now);

    expect(deleted).toContain(exactId);
    const row = await db
      .select()
      .from(schema.shares)
      .where(eq(schema.shares.id, exactId))
      .get();
    expect(row).toBeUndefined();
  });

  test("returns an empty array when nothing is expired", async () => {
    const now = new Date("2026-06-20T12:00:00.000Z");
    await seedShare(null);
    await seedShare("2030-01-01T00:00:00.000Z");

    const deleted = await sweepExpiredShares(now);
    expect(deleted).toEqual([]);
  });
});
