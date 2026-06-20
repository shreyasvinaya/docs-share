import { afterEach, describe, expect, test } from "bun:test";
import { inArray, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { cleanupWebhookDeliveries } from "./webhookCleanup.js";

const cleanup = {
  deliveryIds: [] as string[],
  webhookIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.deliveryIds.length)
    await db
      .delete(schema.webhookDeliveries)
      .where(inArray(schema.webhookDeliveries.id, cleanup.deliveryIds))
      .run();
  if (cleanup.webhookIds.length)
    await db
      .delete(schema.webhooks)
      .where(inArray(schema.webhooks.id, cleanup.webhookIds))
      .run();
  if (cleanup.userIds.length)
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, cleanup.userIds))
      .run();
  cleanup.deliveryIds = [];
  cleanup.webhookIds = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function seedWebhook(): Promise<string> {
  const userId = testId("user");
  const webhookId = testId("wh");
  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: "User",
    googleId: `g_${userId}`,
  });
  await db.insert(schema.webhooks).values({
    id: webhookId,
    ownerUserId: userId,
    url: "https://hooks.example.com/in",
    secret: "whsec_test",
    events: '["share.created"]',
    active: true,
  });
  cleanup.userIds.push(userId);
  cleanup.webhookIds.push(webhookId);
  return webhookId;
}

async function seedDelivery(webhookId: string, createdAt: string): Promise<string> {
  const id = testId("del");
  await db.insert(schema.webhookDeliveries).values({
    id,
    webhookId,
    event: "share.created",
    status: "success",
    responseCode: 200,
    attempts: 1,
    error: null,
    createdAt,
  });
  cleanup.deliveryIds.push(id);
  return id;
}

describe("cleanupWebhookDeliveries", () => {
  test("deletes only deliveries older than the retention window", async () => {
    const webhookId = await seedWebhook();
    const now = new Date("2026-06-20T12:00:00.000Z");

    // 40 days old -> beyond a 30-day retention window.
    const oldId = await seedDelivery(webhookId, "2026-05-11T12:00:00.000Z");
    // 10 days old -> within the window.
    const recentId = await seedDelivery(webhookId, "2026-06-10T12:00:00.000Z");

    const result = await cleanupWebhookDeliveries({
      now,
      retentionDays: 30,
      maxPerWebhook: 0,
    });

    expect(result.deletedByAge).toBe(1);

    const remaining = await db
      .select({ id: schema.webhookDeliveries.id })
      .from(schema.webhookDeliveries)
      .where(inArray(schema.webhookDeliveries.id, [oldId, recentId]))
      .all();
    const remainingIds = remaining.map((r) => r.id);
    expect(remainingIds).not.toContain(oldId);
    expect(remainingIds).toContain(recentId);
  });

  test("keeps only the most recent N deliveries per webhook", async () => {
    const webhookId = await seedWebhook();

    const oldest = await seedDelivery(webhookId, "2026-06-01T00:00:00.000Z");
    const middle = await seedDelivery(webhookId, "2026-06-02T00:00:00.000Z");
    const newest = await seedDelivery(webhookId, "2026-06-03T00:00:00.000Z");

    const result = await cleanupWebhookDeliveries({
      retentionDays: 0,
      maxPerWebhook: 2,
    });

    expect(result.deletedByCap).toBe(1);

    const remaining = await db
      .select({ id: schema.webhookDeliveries.id })
      .from(schema.webhookDeliveries)
      .where(inArray(schema.webhookDeliveries.id, [oldest, middle, newest]))
      .all();
    const remainingIds = remaining.map((r) => r.id);
    // Oldest row is pruned; the two newest are kept.
    expect(remainingIds).not.toContain(oldest);
    expect(remainingIds).toContain(middle);
    expect(remainingIds).toContain(newest);
  });

  test("per-webhook cap is scoped per webhook", async () => {
    const webhookA = await seedWebhook();
    const webhookB = await seedWebhook();

    // Each webhook gets 2 deliveries; with a cap of 1, exactly one per webhook
    // should be pruned (the cap must not be applied globally).
    await seedDelivery(webhookA, "2026-06-01T00:00:00.000Z");
    const newestA = await seedDelivery(webhookA, "2026-06-02T00:00:00.000Z");
    await seedDelivery(webhookB, "2026-06-01T00:00:00.000Z");
    const newestB = await seedDelivery(webhookB, "2026-06-02T00:00:00.000Z");

    const result = await cleanupWebhookDeliveries({
      retentionDays: 0,
      maxPerWebhook: 1,
    });

    expect(result.deletedByCap).toBe(2);

    const remaining = await db
      .select({ id: schema.webhookDeliveries.id })
      .from(schema.webhookDeliveries)
      .where(inArray(schema.webhookDeliveries.id, [newestA, newestB]))
      .all();
    const remainingIds = remaining.map((r) => r.id);
    expect(remainingIds).toContain(newestA);
    expect(remainingIds).toContain(newestB);
  });

  test("composite (webhook_id, created_at) index exists and backs the per-hook cap (FIX 10)", async () => {
    // Migration 0016 adds this composite index so the per-webhook cap's
    // correlated subquery is index-backed instead of an O(n^2) scan.
    const idx = await db
      .select({ name: sql<string>`name` })
      .from(sql`sqlite_master`)
      .where(sql`type = 'index' AND name = 'webhook_deliveries_webhook_created_idx'`)
      .all();
    expect(idx.map((r) => r.name)).toContain(
      "webhook_deliveries_webhook_created_idx"
    );
  });

  test("does nothing when both policies are disabled", async () => {
    const webhookId = await seedWebhook();
    await seedDelivery(webhookId, "2020-01-01T00:00:00.000Z");

    const result = await cleanupWebhookDeliveries({
      retentionDays: 0,
      maxPerWebhook: 0,
    });

    expect(result).toEqual({ deletedByAge: 0, deletedByCap: 0 });
  });
});
