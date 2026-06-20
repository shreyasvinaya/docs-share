import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { recordAuditEntry } from "../services/analytics.js";
import type { AppEnv } from "../lib/types.js";
import auditRoutes from "./audit.js";

const cleanup = {
  auditTargets: [] as string[],
  userIds: [] as string[],
  sysadminEmails: null as string | null,
};

afterEach(async () => {
  if (cleanup.sysadminEmails !== null) {
    config.SYSADMIN_EMAILS = cleanup.sysadminEmails;
    cleanup.sysadminEmails = null;
  }
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
  cleanup.auditTargets = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** Overrides SYSADMIN_EMAILS for the duration of a test (restored in afterEach). */
function setSysadminEmails(value: string): void {
  if (cleanup.sysadminEmails === null) {
    cleanup.sysadminEmails = config.SYSADMIN_EMAILS;
  }
  config.SYSADMIN_EMAILS = value;
}

function appAs(userId: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    c.set("authMethod", "session");
    return next();
  });
  app.route("/api/audit", auditRoutes);
  return app;
}

interface SeededUser {
  userId: string;
  email: string;
}

async function seedUser(role: "user" | "sysadmin" = "user"): Promise<SeededUser> {
  const userId = testId("user");
  const email = `${userId}@example.com`;
  await db.insert(schema.users).values({
    id: userId,
    email,
    displayName: "Actor",
    googleId: `g_${userId}`,
    role,
  });
  cleanup.userIds.push(userId);
  return { userId, email };
}

describe("GET /api/audit", () => {
  test("returns only the caller's own entries", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const ownTarget = testId("share");
    const otherTarget = testId("share");
    cleanup.auditTargets.push(ownTarget, otherTarget);

    await recordAuditEntry({
      actorUserId: owner.userId,
      action: "share.created",
      targetType: "share",
      targetId: ownTarget,
    });
    await recordAuditEntry({
      actorUserId: other.userId,
      action: "share.created",
      targetType: "share",
      targetId: otherTarget,
    });

    const res = await appAs(owner.userId).request("/api/audit");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { targetId: string }[] };
    const targets = body.data.map((e) => e.targetId);
    expect(targets).toContain(ownTarget);
    expect(targets).not.toContain(otherTarget);
  });
});

describe("GET /api/audit/all", () => {
  test("forbids non-sysadmins", async () => {
    const user = await seedUser("user");
    setSysadminEmails("only-real-admin@example.com");
    expect(user.email).not.toBe("only-real-admin@example.com");

    const res = await appAs(user.userId).request("/api/audit/all");
    expect(res.status).toBe(403);
  });

  test("returns cross-user entries for sysadmins", async () => {
    const admin = await seedUser("sysadmin");
    setSysadminEmails(admin.email);
    const other = await seedUser();
    const otherTarget = testId("share");
    cleanup.auditTargets.push(otherTarget);

    await recordAuditEntry({
      actorUserId: other.userId,
      action: "share.revoked",
      targetType: "share",
      targetId: otherTarget,
    });

    const res = await appAs(admin.userId).request("/api/audit/all");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { targetId: string }[] };
    expect(body.data.map((e) => e.targetId)).toContain(otherTarget);
  });
});
