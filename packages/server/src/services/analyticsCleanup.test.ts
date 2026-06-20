import { afterEach, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { cleanupAuditLog, cleanupViewEvents } from "./analyticsCleanup.js";

const cleanup = {
  viewIds: [] as string[],
  auditIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.viewIds.length)
    await db
      .delete(schema.viewEvents)
      .where(inArray(schema.viewEvents.id, cleanup.viewIds))
      .run();
  if (cleanup.auditIds.length)
    await db
      .delete(schema.auditLog)
      .where(inArray(schema.auditLog.id, cleanup.auditIds))
      .run();
  if (cleanup.userIds.length)
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, cleanup.userIds))
      .run();
  cleanup.viewIds = [];
  cleanup.auditIds = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function seedView(viewedAt: string): Promise<string> {
  const id = testId("ve");
  await db.insert(schema.viewEvents).values({
    id,
    targetType: "share",
    targetId: testId("tgt"),
    viewedAt,
    visitorHash: "h",
  });
  cleanup.viewIds.push(id);
  return id;
}

async function seedAudit(createdAt: string): Promise<string> {
  const id = testId("al");
  await db.insert(schema.auditLog).values({
    id,
    actorUserId: null,
    action: "test.action",
    targetType: "share",
    targetId: testId("tgt"),
    createdAt,
  });
  cleanup.auditIds.push(id);
  return id;
}

describe("cleanupViewEvents (FIX 5b)", () => {
  test("deletes only view_events older than the retention window", async () => {
    const now = new Date("2026-06-20T12:00:00.000Z");
    // 100 days old -> beyond a 90-day window.
    const oldId = await seedView("2026-03-12T12:00:00.000Z");
    // 10 days old -> within the window.
    const recentId = await seedView("2026-06-10T12:00:00.000Z");

    const result = await cleanupViewEvents({ now, retentionDays: 90 });
    expect(result.deletedByAge).toBe(1);

    const remaining = await db
      .select({ id: schema.viewEvents.id })
      .from(schema.viewEvents)
      .where(inArray(schema.viewEvents.id, [oldId, recentId]))
      .all();
    const ids = remaining.map((r) => r.id);
    expect(ids).not.toContain(oldId);
    expect(ids).toContain(recentId);
  });

  test("is a no-op when retention is disabled", async () => {
    const id = await seedView("2000-01-01T00:00:00.000Z");
    const result = await cleanupViewEvents({ retentionDays: 0 });
    expect(result.deletedByAge).toBe(0);

    const remaining = await db
      .select({ id: schema.viewEvents.id })
      .from(schema.viewEvents)
      .where(inArray(schema.viewEvents.id, [id]))
      .all();
    expect(remaining).toHaveLength(1);
  });
});

describe("cleanupAuditLog (FIX 5b)", () => {
  test("deletes only audit_log rows older than the retention window", async () => {
    const now = new Date("2026-06-20T12:00:00.000Z");
    // ~400 days old -> beyond a 365-day window.
    const oldId = await seedAudit("2025-05-01T12:00:00.000Z");
    // 30 days old -> within the window.
    const recentId = await seedAudit("2026-05-21T12:00:00.000Z");

    const result = await cleanupAuditLog({ now, retentionDays: 365 });
    expect(result.deletedByAge).toBe(1);

    const remaining = await db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(inArray(schema.auditLog.id, [oldId, recentId]))
      .all();
    const ids = remaining.map((r) => r.id);
    expect(ids).not.toContain(oldId);
    expect(ids).toContain(recentId);
  });

  test("is a no-op when retention is disabled", async () => {
    const id = await seedAudit("2000-01-01T00:00:00.000Z");
    const result = await cleanupAuditLog({ retentionDays: 0 });
    expect(result.deletedByAge).toBe(0);

    const remaining = await db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(inArray(schema.auditLog.id, [id]))
      .all();
    expect(remaining).toHaveLength(1);
  });
});
