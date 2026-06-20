import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashToken } from "../lib/crypto.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { sessionMiddleware } from "../middleware/session.js";
import type { AppEnv } from "../lib/types.js";
import authRoutes from "./auth.js";

const routeApp = new Hono<AppEnv>();
// The real request pipeline: session cookies are resolved first, then routes.
// requireSession (inside the token-management routes) keys off authMethod,
// which sessionMiddleware/requireAuth populate.
routeApp.use("*", sessionMiddleware);
routeApp.route("/api/auth", authRoutes);
// A protected probe endpoint to confirm a revoked token can no longer auth.
routeApp.get("/api/protected", requireAuth, (c) => c.json({ ok: true }));

const cleanup = {
  tokenIds: [] as string[],
  userIds: [] as string[],
  sessionIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.tokenIds.length)
    await db
      .delete(schema.apiTokens)
      .where(inArray(schema.apiTokens.id, cleanup.tokenIds))
      .run();
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
  cleanup.tokenIds = [];
  cleanup.userIds = [];
  cleanup.sessionIds = [];
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

/** A logged-in human session: token management is allowed only this way. */
async function seedSession(userId: string): Promise<string> {
  const sessionId = testId("session");
  await db.insert(schema.sessions).values({
    id: sessionId,
    userId,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  cleanup.sessionIds.push(sessionId);
  return sessionId;
}

async function seedToken(
  userId: string,
  scopes = "*"
): Promise<{ id: string; token: string }> {
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
  return { id: tokenId, token };
}

function sessionHeaders(sessionId: string): HeadersInit {
  return { Cookie: `ds_session=${sessionId}` };
}

function bearerHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

describe("api token management is session-only", () => {
  // CRITICAL escalation guard: a bearer API token must never be able to mint,
  // list, or revoke tokens. Otherwise a narrow `draft:read` token could POST a
  // new `scopes: "*"` token and escalate to full access.
  test("api_token cannot MINT a token (POST /tokens -> 403)", async () => {
    const userId = await seedUser("Escalator");
    // Even a `*` token (the strongest) must be rejected: management is
    // session-only, not scope-gated.
    const { token } = await seedToken(userId, "*");

    const res = await routeApp.request("/api/auth/tokens", {
      method: "POST",
      headers: bearerHeaders(token),
      body: JSON.stringify({ name: "escalated", scopes: "*" }),
    });
    expect(res.status).toBe(403);

    // And nothing was written: still exactly the one seeded token for this user.
    const rows = await db
      .select()
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.userId, userId))
      .all();
    expect(rows.length).toBe(1);
  });

  test("api_token cannot LIST tokens (GET /tokens -> 403)", async () => {
    const userId = await seedUser("Lister");
    const { token } = await seedToken(userId, "*");

    const res = await routeApp.request("/api/auth/tokens", {
      headers: bearerHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  test("api_token cannot REVOKE a token (DELETE /tokens/:id -> 403)", async () => {
    const userId = await seedUser("Revoker");
    const { token } = await seedToken(userId, "*");
    const victim = await seedToken(userId, "*");

    const res = await routeApp.request(`/api/auth/tokens/${victim.id}`, {
      method: "DELETE",
      headers: bearerHeaders(token),
    });
    expect(res.status).toBe(403);

    // The victim token must NOT have been revoked.
    const row = await db
      .select({ revokedAt: schema.apiTokens.revokedAt })
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.id, victim.id))
      .get();
    expect(row?.revokedAt).toBeNull();
  });

  test("a session CAN mint a token (POST /tokens -> 201)", async () => {
    const userId = await seedUser("Human");
    const sessionId = await seedSession(userId);

    const res = await routeApp.request("/api/auth/tokens", {
      method: "POST",
      headers: { ...sessionHeaders(sessionId), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ci", scopes: "repo:read" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; token: string; scopes: string };
    cleanup.tokenIds.push(body.id);
    expect(body.token.startsWith("pat_")).toBe(true);
    expect(body.scopes).toBe("repo:read");
  });
});

describe("api token soft-revoke (session-driven)", () => {
  test("DELETE soft-revokes (sets revokedAt) instead of hard-deleting", async () => {
    const userId = await seedUser("Owner");
    const sessionId = await seedSession(userId);
    const { id } = await seedToken(userId);

    const res = await routeApp.request(`/api/auth/tokens/${id}`, {
      method: "DELETE",
      headers: sessionHeaders(sessionId),
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
      headers: bearerHeaders(token),
    });
    expect(before.status).toBe(200);

    await db
      .update(schema.apiTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(schema.apiTokens.id, id))
      .run();

    const after = await routeApp.request("/api/protected", {
      headers: bearerHeaders(token),
    });
    expect(after.status).toBe(401);
  });

  test("revoking an already-revoked token returns 404", async () => {
    const userId = await seedUser("Owner");
    const sessionId = await seedSession(userId);
    const target = await seedToken(userId);

    await db
      .update(schema.apiTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(schema.apiTokens.id, target.id))
      .run();

    const res = await routeApp.request(`/api/auth/tokens/${target.id}`, {
      method: "DELETE",
      headers: sessionHeaders(sessionId),
    });
    expect(res.status).toBe(404);
  });

  test("GET /tokens surfaces revoked status", async () => {
    const userId = await seedUser("Owner");
    const sessionId = await seedSession(userId);
    const active = await seedToken(userId);
    const revoked = await seedToken(userId);

    await db
      .update(schema.apiTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(schema.apiTokens.id, revoked.id))
      .run();

    const res = await routeApp.request("/api/auth/tokens", {
      headers: sessionHeaders(sessionId),
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
