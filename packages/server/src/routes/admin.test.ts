import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { hashToken } from "../lib/crypto.js";
import type { AppEnv } from "../lib/types.js";
import adminRoutes from "./admin.js";

const app = new Hono<AppEnv>();
app.route("/api/admin", adminRoutes);

const cleanup = {
  tokenIds: [] as string[],
  userIds: [] as string[],
  sysadminEmails: null as string | null,
  deploymentName: undefined as string | undefined | null,
};

afterEach(async () => {
  if (cleanup.tokenIds.length) {
    await db
      .delete(schema.apiTokens)
      .where(inArray(schema.apiTokens.id, cleanup.tokenIds))
      .run();
  }
  if (cleanup.userIds.length) {
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, cleanup.userIds))
      .run();
  }
  if (cleanup.sysadminEmails !== null)
    config.SYSADMIN_EMAILS = cleanup.sysadminEmails;
  if (cleanup.deploymentName !== undefined) {
    if (cleanup.deploymentName === null) delete process.env.DEPLOYMENT_NAME;
    else process.env.DEPLOYMENT_NAME = cleanup.deploymentName;
  }
  cleanup.tokenIds = [];
  cleanup.userIds = [];
  cleanup.sysadminEmails = null;
  cleanup.deploymentName = undefined;
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function seedUser(
  role: "user" | "sysadmin"
): Promise<{ token: string; userId: string; email: string }> {
  const userId = testId("user");
  const email = `${userId}@example.com`;
  const token = `ds_test_${testId("token")}`;
  const tokenId = testId("api_token");

  await db.insert(schema.users).values({
    id: userId,
    email,
    displayName: "Admin Test",
    googleId: `google_${userId}`,
    role,
  });
  await db.insert(schema.apiTokens).values({
    id: tokenId,
    userId,
    name: "test",
    tokenPrefix: token.slice(0, 8),
    tokenHash: hashToken(token),
    scopes: "*",
  });

  cleanup.userIds.push(userId);
  cleanup.tokenIds.push(tokenId);
  return { token, userId, email };
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/** Make the seeded sysadmin's email authoritative via SYSADMIN_EMAILS. */
function makeSysadmin(email: string) {
  cleanup.sysadminEmails = config.SYSADMIN_EMAILS;
  config.SYSADMIN_EMAILS = email;
}

describe("admin routes (requireSysadmin)", () => {
  test("rejects unauthenticated callers with 401", async () => {
    const res = await app.request("/api/admin/users");
    expect(res.status).toBe(401);
  });

  test("rejects non-sysadmin callers with 403", async () => {
    const { token } = await seedUser("user");
    const res = await app.request("/api/admin/users", {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  test("lists users for a sysadmin", async () => {
    const admin = await seedUser("sysadmin");
    makeSysadmin(admin.email);

    const res = await app.request("/api/admin/users", {
      headers: authHeaders(admin.token),
    });
    const body = (await res.json()) as {
      data: { users: Array<{ id: string; email: string; role: string }> };
    };

    expect(res.status).toBe(200);
    const found = body.data.users.find((u) => u.id === admin.userId);
    expect(found).toBeTruthy();
    expect(found?.email).toBe(admin.email);
    expect(found?.role).toBe("sysadmin");
    // Must not leak sensitive columns.
    expect(JSON.stringify(body)).not.toContain("githubToken");
  });

  test("non-sysadmin cannot patch a user's role", async () => {
    const { token } = await seedUser("user");
    const target = await seedUser("user");

    const res = await app.request(`/api/admin/users/${target.userId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ role: "sysadmin" }),
    });

    expect(res.status).toBe(403);
    const stored = await db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, target.userId))
      .get();
    expect(stored?.role).toBe("user");
  });

  test("refuses to grant the sysadmin role via the API and leaves the DB untouched", async () => {
    const admin = await seedUser("sysadmin");
    makeSysadmin(admin.email);
    const target = await seedUser("user");

    const res = await app.request(`/api/admin/users/${target.userId}`, {
      method: "PATCH",
      headers: authHeaders(admin.token),
      body: JSON.stringify({ role: "sysadmin" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(
      "The sysadmin role is managed via the SYSADMIN_EMAILS environment variable, not the API."
    );

    // The DB role must NOT have changed — env is the source of truth.
    const stored = await db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, target.userId))
      .get();
    expect(stored?.role).toBe("user");
  });

  test("also refuses to set role back to user via the API", async () => {
    const admin = await seedUser("sysadmin");
    makeSysadmin(admin.email);
    const target = await seedUser("user");

    const res = await app.request(`/api/admin/users/${target.userId}`, {
      method: "PATCH",
      headers: authHeaders(admin.token),
      body: JSON.stringify({ role: "user" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(
      "The sysadmin role is managed via the SYSADMIN_EMAILS environment variable, not the API."
    );
  });

  test("rejects invalid role values", async () => {
    const admin = await seedUser("sysadmin");
    makeSysadmin(admin.email);
    const target = await seedUser("user");

    const res = await app.request(`/api/admin/users/${target.userId}`, {
      method: "PATCH",
      headers: authHeaders(admin.token),
      body: JSON.stringify({ role: "superuser" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid role");
  });

  test("exposes deployment branding to sysadmins", async () => {
    const admin = await seedUser("sysadmin");
    makeSysadmin(admin.email);
    cleanup.deploymentName = process.env.DEPLOYMENT_NAME ?? null;
    process.env.DEPLOYMENT_NAME = "Acme Internal Docs";
    // (cleanup restores or deletes this in afterEach)

    const res = await app.request("/api/admin/branding", {
      headers: authHeaders(admin.token),
    });
    const body = (await res.json()) as { data: { deploymentName: string } };

    expect(res.status).toBe(200);
    expect(body.data.deploymentName).toBe("Acme Internal Docs");
  });

  test("hides deployment branding from non-sysadmins", async () => {
    const { token } = await seedUser("user");
    const res = await app.request("/api/admin/branding", {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });
});
