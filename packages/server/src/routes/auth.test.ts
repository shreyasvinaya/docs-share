import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { sessionMiddleware } from "../middleware/session.js";
import authRoutes from "./auth.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();
app.use("*", sessionMiddleware);
app.route("/api/auth", authRoutes);

const cleanup = {
  sessionIds: [] as string[],
  userIds: [] as string[],
  roleRestores: [] as { userId: string; role: "user" | "sysadmin" }[],
  sysadminEmails: null as string | null,
};

afterEach(async () => {
  if (cleanup.sysadminEmails !== null) {
    config.SYSADMIN_EMAILS = cleanup.sysadminEmails;
  }
  for (const restore of cleanup.roleRestores) {
    await db
      .update(schema.users)
      .set({ role: restore.role })
      .where(eq(schema.users.id, restore.userId))
      .run();
  }
  if (cleanup.sessionIds.length) {
    await db
      .delete(schema.sessions)
      .where(inArray(schema.sessions.id, cleanup.sessionIds))
      .run();
  }
  if (cleanup.userIds.length) {
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, cleanup.userIds))
      .run();
  }
  cleanup.sessionIds = [];
  cleanup.userIds = [];
  cleanup.roleRestores = [];
  cleanup.sysadminEmails = null;
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

describe("auth session", () => {
  test("refreshes deployment role for an existing sysadmin email", async () => {
    cleanup.sysadminEmails = config.SYSADMIN_EMAILS;
    config.SYSADMIN_EMAILS = "abc@gmail.com";
    let user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "abc@gmail.com"))
      .get();
    const userId = user?.id ?? testId("user");
    const sessionId = testId("session");

    if (user) {
      cleanup.roleRestores.push({ userId: user.id, role: user.role });
      await db
        .update(schema.users)
        .set({ role: "user" })
        .where(eq(schema.users.id, user.id))
        .run();
    } else {
      await db.insert(schema.users).values({
        id: userId,
        email: "abc@gmail.com",
        displayName: "ABC Admin",
        googleId: `google_${userId}`,
        role: "user",
      });
      cleanup.userIds.push(userId);
    }

    await db.insert(schema.sessions).values({
      id: sessionId,
      userId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    cleanup.sessionIds.push(sessionId);

    const res = await app.request("/api/auth/session", {
      headers: { Cookie: `ds_session=${sessionId}` },
    });
    const body = (await res.json()) as { user: { role: string } };

    expect(res.status).toBe(200);
    expect(body.user.role).toBe("sysadmin");
    const stored = await db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();
    expect(stored?.role).toBe("sysadmin");
  });
});
