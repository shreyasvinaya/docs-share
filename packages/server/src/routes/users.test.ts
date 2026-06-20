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

describe("GitHub integration settings routes", () => {
  test("returns the deployment role for the current user", async () => {
    const { token, userId } = await seedUserWithToken();
    await db
      .update(schema.users)
      .set({ role: "sysadmin" })
      .where(eq(schema.users.id, userId))
      .run();

    const res = await app.request("/api/users/me", {
      headers: authHeaders(token),
    });
    const body = (await res.json()) as { data: { role: string } };

    expect(res.status).toBe(200);
    expect(body.data.role).toBe("sysadmin");
  });

  test("stores GitHub App installation status from a validated callback", async () => {
    const { token, userId } = await seedUserWithToken();
    const state = "state_test_github_app";

    const callbackRes = await app.request(
      `/api/users/me/github-app/callback?installation_id=98765&setup_action=install&state=${state}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Cookie: `github_app_state=${state}`,
        },
      }
    );
    const statusRes = await app.request("/api/users/me/github-token", {
      headers: authHeaders(token),
    });
    const statusBody = (await statusRes.json()) as {
      data: {
        connected: boolean;
        connectionType: "github_app" | "pat" | null;
        installationId: string | null;
      };
    };
    const stored = await db
      .select({
        installationId: schema.users.githubAppInstallationId,
        connectedAt: schema.users.githubAppConnectedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();

    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get("location")).toBe("/settings?tab=integrations");
    expect(statusRes.status).toBe(200);
    expect(statusBody.data.connected).toBe(true);
    expect(statusBody.data.connectionType).toBe("github_app");
    expect(statusBody.data.installationId).toBe("98765");
    expect(JSON.stringify(statusBody)).not.toContain("github_pat_");
    expect(stored?.installationId).toBe("98765");
    expect(stored?.connectedAt).toBeTruthy();
  });

  test("rejects GitHub App callbacks with an invalid state", async () => {
    const { token, userId } = await seedUserWithToken();

    const callbackRes = await app.request(
      "/api/users/me/github-app/callback?installation_id=98765&state=actual",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Cookie: "github_app_state=expected",
        },
      }
    );
    const stored = await db
      .select({ installationId: schema.users.githubAppInstallationId })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();

    expect(callbackRes.status).toBe(400);
    expect(stored?.installationId).toBeNull();
  });

  test("disconnects only the current user's GitHub App installation", async () => {
    const first = await seedUserWithToken();
    const second = await seedUserWithToken();
    const now = new Date().toISOString();

    await db
      .update(schema.users)
      .set({
        githubAppInstallationId: "first_installation",
        githubAppConnectedAt: now,
      })
      .where(eq(schema.users.id, first.userId))
      .run();
    await db
      .update(schema.users)
      .set({
        githubAppInstallationId: "second_installation",
        githubAppConnectedAt: now,
      })
      .where(eq(schema.users.id, second.userId))
      .run();

    const deleteRes = await app.request("/api/users/me/github-token", {
      method: "DELETE",
      headers: authHeaders(first.token),
    });
    const firstUser = await db
      .select({ installationId: schema.users.githubAppInstallationId })
      .from(schema.users)
      .where(eq(schema.users.id, first.userId))
      .get();
    const secondUser = await db
      .select({ installationId: schema.users.githubAppInstallationId })
      .from(schema.users)
      .where(eq(schema.users.id, second.userId))
      .get();

    expect(deleteRes.status).toBe(200);
    expect(firstUser?.installationId).toBeNull();
    expect(secondUser?.installationId).toBe("second_installation");
  });

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
