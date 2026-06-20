import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashToken } from "../lib/crypto.js";
import { requireAuth } from "../middleware/requireAuth.js";
import type { AppEnv } from "../lib/types.js";
import authRoutes from "./auth.js";

const routeApp = new Hono<AppEnv>();
routeApp.route("/api/auth", authRoutes);
// A protected probe endpoint to confirm a revoked token can no longer auth.
routeApp.get("/api/protected", requireAuth, (c) => c.json({ ok: true }));

const cleanup = {
  tokenIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.tokenIds.length)
    await db
      .delete(schema.apiTokens)
      .where(inArray(schema.apiTokens.id, cleanup.tokenIds))
      .run();
  if (cleanup.userIds.length)
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, cleanup.userIds))
      .run();
  cleanup.tokenIds = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function seedUser(label: string): Promise<string> {
  const userId = testId(`user_${label}`);
  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: label,
    googleId: `google_${userId}`,
  });
  cleanup.userIds.push(userId);
  return userId;
}

async function seedToken(userId: string): Promise<{ id: string; token: string }> {
  const token = `ds_test_${testId("token")}`;
  const tokenId = testId("api_token");
  await db.insert(schema.apiTokens).values({
    id: tokenId,
    userId,
    name: "Test token",
    tokenPrefix: token.slice(0, 8),
    tokenHash: hashToken(token),
    scopes: "*",
  });
  cleanup.tokenIds.push(tokenId);
  return { id: tokenId, token };
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

describe("api token soft-revoke", () => {
  test("DELETE soft-revokes (sets revokedAt) instead of hard-deleting", async () => {
    const userId = await seedUser("Owner");
    const { id, token } = await seedToken(userId);

    const res = await routeApp.request(`/api/auth/tokens/${id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);

    // Row still exists, with revokedAt populated.
    const row = await db
      .select()
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.id, id))
      .get();
    expect(row).toBeTruthy();
    expect(row?.revokedAt).toBeTruthy();
  });

  test("a revoked token is rejected by requireAuth", async () => {
    const userId = await seedUser("Owner");
    const { id, token } = await seedToken(userId);

    const before = await routeApp.request("/api/protected", {
      headers: authHeaders(token),
    });
    expect(before.status).toBe(200);

    await db
      .update(schema.apiTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(schema.apiTokens.id, id))
      .run();

    const after = await routeApp.request("/api/protected", {
      headers: authHeaders(token),
    });
    expect(after.status).toBe(401);
  });

  test("revoking an already-revoked token returns 404", async () => {
    const userId = await seedUser("Owner");
    const active = await seedToken(userId);
    const target = await seedToken(userId);

    await db
      .update(schema.apiTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(schema.apiTokens.id, target.id))
      .run();

    const res = await routeApp.request(`/api/auth/tokens/${target.id}`, {
      method: "DELETE",
      headers: authHeaders(active.token),
    });
    expect(res.status).toBe(404);
  });

  test("GET /tokens surfaces revoked status", async () => {
    const userId = await seedUser("Owner");
    const active = await seedToken(userId);
    const revoked = await seedToken(userId);

    await db
      .update(schema.apiTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(schema.apiTokens.id, revoked.id))
      .run();

    const res = await routeApp.request("/api/auth/tokens", {
      headers: authHeaders(active.token),
    });
    const body = (await res.json()) as {
      tokens: { id: string; revokedAt: string | null }[];
    };
    expect(res.status).toBe(200);

    const revokedRow = body.tokens.find((t) => t.id === revoked.id);
    const activeRow = body.tokens.find((t) => t.id === active.id);
    expect(revokedRow?.revokedAt).toBeTruthy();
    expect(activeRow?.revokedAt).toBeNull();
  });
});
