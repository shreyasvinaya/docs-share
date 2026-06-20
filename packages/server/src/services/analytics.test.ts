import { afterEach, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import {
  aggregateViewStats,
  computeVisitorHash,
  extractClientIp,
  recordAuditEntry,
  recordViewEvent,
} from "./analytics.js";

const cleanup = {
  viewTargets: [] as string[],
  auditTargets: [] as string[],
  userIds: [] as string[],
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
  if (cleanup.userIds.length)
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, cleanup.userIds))
      .run();
  cleanup.viewTargets = [];
  cleanup.auditTargets = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

describe("computeVisitorHash", () => {
  test("is deterministic for the same ip + user-agent", () => {
    const a = computeVisitorHash("1.2.3.4", "Mozilla/5.0");
    const b = computeVisitorHash("1.2.3.4", "Mozilla/5.0");
    expect(a).toBe(b);
  });

  test("differs across distinct visitors", () => {
    const a = computeVisitorHash("1.2.3.4", "Mozilla/5.0");
    const b = computeVisitorHash("5.6.7.8", "Mozilla/5.0");
    const c = computeVisitorHash("1.2.3.4", "curl/8.0");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  test("does not contain the raw ip or user agent", () => {
    const hash = computeVisitorHash("203.0.113.9", "SecretAgent/1.0");
    expect(hash).not.toContain("203.0.113.9");
    expect(hash).not.toContain("SecretAgent");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("treats missing values as stable empty inputs", () => {
    const a = computeVisitorHash(null, null);
    const b = computeVisitorHash(undefined, undefined);
    expect(a).toBe(b);
  });
});

describe("extractClientIp", () => {
  test("prefers the first x-forwarded-for hop", () => {
    const headers = new Headers({
      "x-forwarded-for": "9.9.9.9, 10.0.0.1",
    });
    expect(extractClientIp(headers)).toBe("9.9.9.9");
  });

  test("falls back to x-real-ip", () => {
    const headers = new Headers({ "x-real-ip": "8.8.8.8" });
    expect(extractClientIp(headers)).toBe("8.8.8.8");
  });

  test("returns null when no ip headers present", () => {
    expect(extractClientIp(new Headers())).toBeNull();
  });
});

describe("recordViewEvent + aggregateViewStats", () => {
  test("counts total views and unique visitors", async () => {
    const targetId = testId("share");
    cleanup.viewTargets.push(targetId);

    await recordViewEvent({
      targetType: "share",
      targetId,
      ip: "1.1.1.1",
      userAgent: "A",
      referrer: "https://news.example.com/post",
    });
    await recordViewEvent({
      targetType: "share",
      targetId,
      ip: "1.1.1.1",
      userAgent: "A",
      referrer: "https://news.example.com/post",
    });
    await recordViewEvent({
      targetType: "share",
      targetId,
      ip: "2.2.2.2",
      userAgent: "B",
      referrer: null,
    });

    const stats = await aggregateViewStats("share", targetId);
    expect(stats.totalViews).toBe(3);
    expect(stats.uniqueVisitors).toBe(2);
    expect(stats.lastViewedAt).not.toBeNull();
    expect(stats.recentReferrers).toContain("https://news.example.com/post");
  });

  test("returns zeroed stats for a target with no views", async () => {
    const stats = await aggregateViewStats("draft", testId("draft"));
    expect(stats.totalViews).toBe(0);
    expect(stats.uniqueVisitors).toBe(0);
    expect(stats.lastViewedAt).toBeNull();
    expect(stats.recentReferrers).toEqual([]);
  });

  test("does not bleed across target types with the same id", async () => {
    const sharedId = testId("dup");
    cleanup.viewTargets.push(sharedId);
    await recordViewEvent({
      targetType: "share",
      targetId: sharedId,
      ip: "3.3.3.3",
      userAgent: "C",
      referrer: null,
    });

    const draftStats = await aggregateViewStats("draft", sharedId);
    expect(draftStats.totalViews).toBe(0);
    const shareStats = await aggregateViewStats("share", sharedId);
    expect(shareStats.totalViews).toBe(1);
  });
});

describe("recordAuditEntry", () => {
  test("persists an audit row with serialized metadata", async () => {
    const userId = testId("user");
    const targetId = testId("share");
    cleanup.userIds.push(userId);
    cleanup.auditTargets.push(targetId);

    await db.insert(schema.users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "Actor",
      googleId: `g_${userId}`,
    });

    await recordAuditEntry({
      actorUserId: userId,
      action: "share.created",
      targetType: "share",
      targetId,
      metadata: { shareType: "public_link" },
    });

    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, targetId))
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("share.created");
    expect(rows[0].actorUserId).toBe(userId);
    expect(JSON.parse(rows[0].metadata ?? "{}")).toEqual({
      shareType: "public_link",
    });
  });
});
