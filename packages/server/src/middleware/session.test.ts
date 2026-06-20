import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { AppEnv } from "../lib/types.js";
import { sessionMiddleware } from "./session.js";

const cleanup = {
  sessionIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.sessionIds.length)
    await db
      .delete(schema.sessions)
      .where(inArray(schema.sessions.id, cleanup.sessionIds))
      .run();
  if (cleanup.userIds.length)
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, cleanup.userIds))
      .run();
  cleanup.sessionIds = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * App that exposes whether sessionMiddleware authenticated the request by
 * returning the resolved userId (or null when no session was applied).
 */
function probeApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", sessionMiddleware);
  app.get("/whoami", (c) => c.json({ userId: c.get("userId") ?? null }));
  return app;
}

async function seedSession(expiresAt: string): Promise<string> {
  const userId = testId("user");
  const sessionId = testId("sess");
  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: "User",
    googleId: `g_${userId}`,
  });
  await db.insert(schema.sessions).values({
    id: sessionId,
    userId,
    expiresAt,
  });
  cleanup.userIds.push(userId);
  cleanup.sessionIds.push(sessionId);
  return sessionId;
}

describe("sessionMiddleware expiry", () => {
  test("rejects a session that expired one hour ago (same calendar day)", async () => {
    // 1h in the PAST. Crucially same UTC calendar day as now, which is exactly
    // the case the broken `CURRENT_TIMESTAMP` lexical compare let through.
    const expiredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const sessionId = await seedSession(expiredAt);

    const res = await probeApp().request("/whoami", {
      headers: { Cookie: `ds_session=${sessionId}` },
    });
    const body = (await res.json()) as { userId: string | null };
    expect(body.userId).toBeNull();
  });

  test("accepts a session expiring in the future", async () => {
    const futureAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const sessionId = await seedSession(futureAt);

    const res = await probeApp().request("/whoami", {
      headers: { Cookie: `ds_session=${sessionId}` },
    });
    const body = (await res.json()) as { userId: string | null };
    expect(body.userId).not.toBeNull();
  });
});
