import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { sessionMiddleware } from "../middleware/session.js";
import setupRoutes from "./setup.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();
app.use("*", sessionMiddleware);
app.route("/api/setup", setupRoutes);

const cleanup = {
  sessionIds: [] as string[],
  userIds: [] as string[],
  sysadminEmails: null as string | null,
};

afterEach(async () => {
  if (cleanup.sysadminEmails !== null) {
    config.SYSADMIN_EMAILS = cleanup.sysadminEmails;
    cleanup.sysadminEmails = null;
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

interface SeededSession {
  sessionId: string;
  userId: string;
  email: string;
}

async function seedSession(role: "user" | "sysadmin"): Promise<SeededSession> {
  const userId = testId("user");
  const sessionId = testId("session");
  const email = `${userId}@example.com`;

  await db.insert(schema.users).values({
    id: userId,
    email,
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
  return { sessionId, userId, email };
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
    const { sessionId, email } = await seedSession("user");
    setSysadminEmails(`someone-else@example.com`);
    expect(email).not.toBe("someone-else@example.com");

    const res = await app.request("/api/setup/status", {
      headers: { Cookie: `ds_session=${sessionId}` },
    });

    expect(res.status).toBe(403);
  });

  test("returns setup status for a sysadmin user", async () => {
    const { sessionId, email } = await seedSession("sysadmin");
    setSysadminEmails(email);

    const res = await app.request("/api/setup/status", {
      headers: { Cookie: `ds_session=${sessionId}` },
    });
    const body = (await res.json()) as {
      data: { security: { productionSecrets: { configured: boolean } } };
    };

    expect(res.status).toBe(200);
    expect(body.data.security.productionSecrets).toBeDefined();
  });

  test("revokes a stale sysadmin once their email leaves SYSADMIN_EMAILS", async () => {
    // Cached role says sysadmin, but the email is no longer configured.
    const { sessionId, userId, email } = await seedSession("sysadmin");
    setSysadminEmails("only-real-admin@example.com");
    expect(email).not.toBe("only-real-admin@example.com");

    const res = await app.request("/api/setup/status", {
      headers: { Cookie: `ds_session=${sessionId}` },
    });
    expect(res.status).toBe(403);

    // The cached role should have been downgraded to "user".
    const stored = await db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();
    expect(stored?.role).toBe("user");
  });
});
