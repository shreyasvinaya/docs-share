import { afterEach, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import {
  aggregateViewStats,
  computeVisitorHash,
  extractClientIp,
  isHtmlContentType,
  normalizeReferrer,
  recordAuditEntry,
  recordViewEvent,
  recordViewEventDeduped,
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

  test("is keyed by SESSION_SECRET so the hash changes with the key", () => {
    const original = config.SESSION_SECRET;
    try {
      config.SESSION_SECRET = "secret-key-aaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const withKeyA = computeVisitorHash("1.2.3.4", "Mozilla/5.0");
      config.SESSION_SECRET = "secret-key-bbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const withKeyB = computeVisitorHash("1.2.3.4", "Mozilla/5.0");
      expect(withKeyA).not.toBe(withKeyB);
    } finally {
      config.SESSION_SECRET = original;
    }
  });
});

describe("normalizeReferrer", () => {
  test("reduces a full URL to its origin, dropping path/query", () => {
    expect(
      normalizeReferrer("https://news.example.com/post?token=abc#frag")
    ).toBe("https://news.example.com");
  });

  test("returns null for missing or unparseable referrers", () => {
    expect(normalizeReferrer(null)).toBeNull();
    expect(normalizeReferrer(undefined)).toBeNull();
    expect(normalizeReferrer("")).toBeNull();
    expect(normalizeReferrer("not a url")).toBeNull();
  });
});

describe("isHtmlContentType", () => {
  test("matches text/html documents regardless of charset/case", () => {
    expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlContentType("TEXT/HTML")).toBe(true);
  });

  test("rejects non-html and missing content types", () => {
    expect(isHtmlContentType("text/css; charset=utf-8")).toBe(false);
    expect(isHtmlContentType("image/png")).toBe(false);
    expect(isHtmlContentType(null)).toBe(false);
    expect(isHtmlContentType(undefined)).toBe(false);
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
    // Only the referrer ORIGIN is stored/aggregated, never the full URL.
    expect(stats.recentReferrers).toContain("https://news.example.com");
    expect(stats.recentReferrers).not.toContain(
      "https://news.example.com/post"
    );
  });

  test("stores only the referrer origin, never the full URL", async () => {
    const targetId = testId("share");
    cleanup.viewTargets.push(targetId);

    await recordViewEvent({
      targetType: "share",
      targetId,
      ip: "4.4.4.4",
      userAgent: "D",
      referrer: "https://example.com/secret/path?token=abc123",
    });

    const rows = await db
      .select({ referrer: schema.viewEvents.referrer })
      .from(schema.viewEvents)
      .where(eq(schema.viewEvents.targetId, targetId))
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0].referrer).toBe("https://example.com");
  });

  test("returns zeroed stats for a target with no views", async () => {
    const stats = await aggregateViewStats("draft", testId("draft"));
    expect(stats.totalViews).toBe(0);
    expect(stats.uniqueVisitors).toBe(0);
    expect(stats.lastViewedAt).toBeNull();
    expect(stats.recentReferrers).toEqual([]);
  });

  test("dedupes repeat views from the same visitor within the window", async () => {
    const targetId = testId("share");
    cleanup.viewTargets.push(targetId);

    const input = {
      targetType: "share" as const,
      targetId,
      ip: "9.9.9.9",
      userAgent: "Repeat/1.0",
      referrer: "https://example.com/page",
    };

    await recordViewEventDeduped(input);
    // Second view from the same visitor inside the 30-min window: no new row.
    await recordViewEventDeduped(input);

    const stats = await aggregateViewStats("share", targetId);
    expect(stats.totalViews).toBe(1);
    expect(stats.uniqueVisitors).toBe(1);

    // A different visitor on the same target is still recorded.
    await recordViewEventDeduped({
      ...input,
      ip: "8.8.8.8",
      userAgent: "Other/1.0",
    });
    const after = await aggregateViewStats("share", targetId);
    expect(after.totalViews).toBe(2);
    expect(after.uniqueVisitors).toBe(2);
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
