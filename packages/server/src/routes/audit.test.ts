import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { recordAuditEntry } from "../services/analytics.js";
import type { AppEnv } from "../lib/types.js";
import auditRoutes from "./audit.js";

const cleanup = {
  auditTargets: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
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

async function seedUser(isSysadmin = false): Promise<string> {
  const userId = testId("user");
  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: "Actor",
    googleId: `g_${userId}`,
    isSysadmin,
  });
  cleanup.userIds.push(userId);
  return userId;
}

describe("GET /api/audit", () => {
  test("returns only the caller's own entries", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const ownTarget = testId("share");
    const otherTarget = testId("share");
    cleanup.auditTargets.push(ownTarget, otherTarget);

    await recordAuditEntry({
      actorUserId: owner,
      action: "share.created",
      targetType: "share",
      targetId: ownTarget,
    });
    await recordAuditEntry({
      actorUserId: other,
      action: "share.created",
      targetType: "share",
      targetId: otherTarget,
    });

    const res = await appAs(owner).request("/api/audit");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { targetId: string }[] };
    const targets = body.data.map((e) => e.targetId);
    expect(targets).toContain(ownTarget);
    expect(targets).not.toContain(otherTarget);
  });
});

describe("GET /api/audit/all", () => {
  test("forbids non-sysadmins", async () => {
    const user = await seedUser(false);
    const res = await appAs(user).request("/api/audit/all");
    expect(res.status).toBe(403);
  });

  test("returns cross-user entries for sysadmins", async () => {
    const admin = await seedUser(true);
    const other = await seedUser();
    const otherTarget = testId("share");
    cleanup.auditTargets.push(otherTarget);

    await recordAuditEntry({
      actorUserId: other,
      action: "share.revoked",
      targetType: "share",
      targetId: otherTarget,
    });

    const res = await appAs(admin).request("/api/audit/all");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { targetId: string }[] };
    expect(body.data.map((e) => e.targetId)).toContain(otherTarget);
  });
});
