import { afterEach, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { purgeDeletedSiteDataRecords } from "./siteDataCleanup.js";

const cleanup = {
  recordIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.recordIds.length)
    await db
      .delete(schema.siteDataRecords)
      .where(inArray(schema.siteDataRecords.id, cleanup.recordIds))
      .run();
  if (cleanup.userIds.length)
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, cleanup.userIds))
      .run();
  cleanup.recordIds = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function seedUser(): Promise<string> {
  const userId = testId("user");
  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: "Owner",
    googleId: `g_${userId}`,
  });
  cleanup.userIds.push(userId);
  return userId;
}

async function seedRecord(
  ownerUserId: string,
  opts: { createdAt: string; deletedAt: string | null }
): Promise<string> {
  const id = testId("rec");
  await db.insert(schema.siteDataRecords).values({
    id,
    ownerUserId,
    targetType: "draft",
    targetId: testId("tgt"),
    collection: "contact",
    fields: { name: "Ada" },
    visitorHash: "h",
    createdAt: opts.createdAt,
    deletedAt: opts.deletedAt,
  });
  cleanup.recordIds.push(id);
  return id;
}

describe("purgeDeletedSiteDataRecords", () => {
  const now = new Date("2026-06-20T00:00:00.000Z");
  const oldIso = "2026-01-01T00:00:00.000Z"; // ~170 days before `now`
  const recentIso = "2026-06-19T00:00:00.000Z"; // 1 day before `now`

  test("removes only soft-deleted records older than the retention cutoff", async () => {
    const owner = await seedUser();
    // Soft-deleted long ago: should be purged.
    const stale = await seedRecord(owner, {
      createdAt: oldIso,
      deletedAt: oldIso,
    });
    // Soft-deleted recently: kept (within retention).
    const recentlyDeleted = await seedRecord(owner, {
      createdAt: oldIso,
      deletedAt: recentIso,
    });
    // Live (never deleted), even if old: never purged by this sweep.
    const live = await seedRecord(owner, {
      createdAt: oldIso,
      deletedAt: null,
    });

    const result = await purgeDeletedSiteDataRecords({ now, retentionDays: 30 });
    expect(result.deletedByAge).toBe(1);

    const survivors = await db
      .select({ id: schema.siteDataRecords.id })
      .from(schema.siteDataRecords)
      .where(inArray(schema.siteDataRecords.id, [stale, recentlyDeleted, live]))
      .all();
    const survivorIds = survivors.map((r) => r.id);
    expect(survivorIds).not.toContain(stale);
    expect(survivorIds).toContain(recentlyDeleted);
    expect(survivorIds).toContain(live);
  });

  test("is a no-op when retentionDays is non-positive", async () => {
    const owner = await seedUser();
    const stale = await seedRecord(owner, {
      createdAt: oldIso,
      deletedAt: oldIso,
    });

    const result = await purgeDeletedSiteDataRecords({ now, retentionDays: 0 });
    expect(result.deletedByAge).toBe(0);

    const stillThere = await db
      .select({ id: schema.siteDataRecords.id })
      .from(schema.siteDataRecords)
      .where(eq(schema.siteDataRecords.id, stale))
      .get();
    expect(stillThere).not.toBeUndefined();
  });
});
