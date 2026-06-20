import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { sessionMiddleware } from "../middleware/session.js";
import setupRoutes from "./setup.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();
app.use("*", sessionMiddleware);
app.route("/api/setup", setupRoutes);

const cleanup = {
  sessionIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
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
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function seedSession(role: "user" | "sysadmin"): Promise<string> {
  const userId = testId("user");
  const sessionId = testId("session");

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: "Setup User",
    googleId: `google_${userId}`,
    role,
  });
  await db.insert(schema.sessions).values({
    id: sessionId,
    userId,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  cleanup.userIds.push(userId);
  cleanup.sessionIds.push(sessionId);
  return sessionId;
}

describe("setup routes", () => {
  test("exposes the public deployment branding", async () => {
    const res = await app.request("/api/setup/branding");
    const body = (await res.json()) as { data: { deploymentName: string } };

    expect(res.status).toBe(200);
    expect(body.data.deploymentName).toBe("Docs Share");
  });

  test("rejects setup status without a session", async () => {
    const res = await app.request("/api/setup/status");
    expect(res.status).toBe(401);
  });

  test("rejects setup status for a non-sysadmin user", async () => {
    const sessionId = await seedSession("user");

    const res = await app.request("/api/setup/status", {
      headers: { Cookie: `ds_session=${sessionId}` },
    });

    expect(res.status).toBe(403);
  });

  test("returns setup status for a sysadmin user", async () => {
    const sessionId = await seedSession("sysadmin");

    const res = await app.request("/api/setup/status", {
      headers: { Cookie: `ds_session=${sessionId}` },
    });
    const body = (await res.json()) as {
      data: { security: { productionSecrets: { configured: boolean } } };
    };

    expect(res.status).toBe(200);
    expect(body.data.security.productionSecrets).toBeDefined();
  });
});
