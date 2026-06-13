import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashToken } from "../lib/crypto.js";
import type { AppEnv } from "../lib/types.js";
import userRoutes from "./users.js";

const app = new Hono<AppEnv>();
app.route("/api/users", userRoutes);

const cleanup = {
  tokenIds: [] as string[],
  userIds: [] as string[],
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
  cleanup.tokenIds = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function seedUserWithToken(): Promise<{ token: string; userId: string }> {
  const userId = testId("user");
  const token = `ds_test_${testId("token")}`;
  const tokenId = testId("api_token");

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: "GitHub User",
    googleId: `google_${userId}`,
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
  return { token, userId };
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

describe("GitHub token settings routes", () => {
  test("stores encrypted token status without returning plaintext", async () => {
    const { token, userId } = await seedUserWithToken();
    const githubToken = "github_pat_user_secret_1234567890";

    const putRes = await app.request("/api/users/me/github-token", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ token: githubToken }),
    });
    const statusRes = await app.request("/api/users/me/github-token", {
      headers: authHeaders(token),
    });
    const statusBody = (await statusRes.json()) as {
      data: { connected: boolean; updatedAt: string | null };
    };
    const stored = await db
      .select({ encrypted: schema.users.githubTokenEncrypted })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();

    expect(putRes.status).toBe(200);
    expect(statusRes.status).toBe(200);
    expect(statusBody.data.connected).toBe(true);
    expect(JSON.stringify(statusBody)).not.toContain(githubToken);
    expect(stored?.encrypted).toBeTruthy();
    expect(stored?.encrypted).not.toContain(githubToken);
  });

  test("disconnects only the current user's GitHub token", async () => {
    const first = await seedUserWithToken();
    const second = await seedUserWithToken();

    await app.request("/api/users/me/github-token", {
      method: "PUT",
      headers: authHeaders(first.token),
      body: JSON.stringify({ token: "github_pat_first_secret_1234567890" }),
    });
    await app.request("/api/users/me/github-token", {
      method: "PUT",
      headers: authHeaders(second.token),
      body: JSON.stringify({ token: "github_pat_second_secret_1234567890" }),
    });

    const deleteRes = await app.request("/api/users/me/github-token", {
      method: "DELETE",
      headers: authHeaders(first.token),
    });
    const firstUser = await db
      .select({ encrypted: schema.users.githubTokenEncrypted })
      .from(schema.users)
      .where(eq(schema.users.id, first.userId))
      .get();
    const secondUser = await db
      .select({ encrypted: schema.users.githubTokenEncrypted })
      .from(schema.users)
      .where(eq(schema.users.id, second.userId))
      .get();

    expect(deleteRes.status).toBe(200);
    expect(firstUser?.encrypted).toBeNull();
    expect(secondUser?.encrypted).toBeTruthy();
  });
});
