import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { hashToken } from "../lib/crypto.js";
import { sessionMiddleware } from "../middleware/session.js";
import authRoutes from "./auth.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();
app.use("*", sessionMiddleware);
app.route("/api/auth", authRoutes);

const cleanup = {
  sessionIds: [] as string[],
  userIds: [] as string[],
  tokenIds: [] as string[],
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
  if (cleanup.tokenIds.length) {
    await db
      .delete(schema.apiTokens)
      .where(inArray(schema.apiTokens.id, cleanup.tokenIds))
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
  cleanup.tokenIds = [];
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

  test("GET /session requires user:read for an api_token (least privilege)", async () => {
    const userId = testId("user");
    await db.insert(schema.users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "Scope Probe",
      googleId: `google_${userId}`,
      role: "user",
    });
    cleanup.userIds.push(userId);

    const seedToken = async (scopes: string): Promise<string> => {
      const token = `ds_test_${testId("token")}`;
      const tokenId = testId("api_token");
      await db.insert(schema.apiTokens).values({
        id: tokenId,
        userId,
        name: "Test token",
        tokenPrefix: token.slice(0, 8),
        tokenHash: hashToken(token),
        scopes,
      });
      cleanup.tokenIds.push(tokenId);
      return token;
    };

    // A token WITHOUT user:read (only draft:read) must be rejected.
    const draftToken = await seedToken("draft:read");
    const denied = await app.request("/api/auth/session", {
      headers: { Authorization: `Bearer ${draftToken}` },
    });
    expect(denied.status).toBe(403);

    // A token WITH user:read can read its identity.
    const userToken = await seedToken("user:read");
    const allowed = await app.request("/api/auth/session", {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(allowed.status).toBe(200);
  });
});
