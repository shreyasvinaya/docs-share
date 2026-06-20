import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashToken } from "../lib/crypto.js";
import type { AppEnv } from "../lib/types.js";
import webhookRoutes, { toWebhookResponse } from "./webhooks.js";

const routeApp = new Hono<AppEnv>();
routeApp.route("/api/webhooks", webhookRoutes);

const cleanup = {
  webhookIds: [] as string[],
  tokenIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.webhookIds.length) {
    await db
      .delete(schema.webhooks)
      .where(inArray(schema.webhooks.id, cleanup.webhookIds))
      .run();
  }
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
  cleanup.webhookIds = [];
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

async function seedToken(userId: string, scopes: string): Promise<string> {
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
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

describe("webhook route helpers", () => {
  test("toWebhookResponse omits the secret and parses events", () => {
    const response = toWebhookResponse({
      id: "wh_1",
      ownerUserId: "u_1",
      url: "https://hooks.example.com/in",
      secret: "whsec_super_secret",
      events: '["share.created","share.revoked"]',
      active: true,
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });

    expect(response).toEqual({
      id: "wh_1",
      url: "https://hooks.example.com/in",
      events: ["share.created", "share.revoked"],
      active: true,
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });
    expect(JSON.stringify(response)).not.toContain("whsec_super_secret");
  });
});

describe("webhook CRUD", () => {
  test("creates a webhook, returns the secret once, then never again", async () => {
    const userId = await seedUser("Owner");
    const token = await seedToken(userId, "*");

    const createRes = await routeApp.request("/api/webhooks", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        url: "https://hooks.example.com/in",
        events: ["share.created", "github_sync.completed"],
      }),
    });
    const created = (await createRes.json()) as {
      data: { id: string; secret?: string; events: string[]; active: boolean };
    };

    expect(createRes.status).toBe(201);
    expect(created.data.secret).toMatch(/^whsec_/);
    expect(created.data.events).toEqual(["share.created", "github_sync.completed"]);
    expect(created.data.active).toBe(true);
    cleanup.webhookIds.push(created.data.id);

    const listRes = await routeApp.request("/api/webhooks", {
      headers: authHeaders(token),
    });
    const list = (await listRes.json()) as {
      data: { id: string; secret?: string }[];
    };

    expect(listRes.status).toBe(200);
    expect(list.data).toHaveLength(1);
    expect(list.data[0].secret).toBeUndefined();
  });

  test("rejects private/loopback and non-http URLs (SSRF guard)", async () => {
    const userId = await seedUser("Guard");
    const token = await seedToken(userId, "*");

    for (const url of [
      "http://localhost:3000/hook",
      "http://169.254.169.254/latest",
      "ftp://example.com",
      "not-a-url",
    ]) {
      const res = await routeApp.request("/api/webhooks", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ url, events: ["share.created"] }),
      });
      expect(res.status).toBe(400);
    }
  });

  test("rejects unknown events", async () => {
    const userId = await seedUser("Events");
    const token = await seedToken(userId, "*");

    const res = await routeApp.request("/api/webhooks", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        url: "https://hooks.example.com/in",
        events: ["share.created", "not.real"],
      }),
    });
    expect(res.status).toBe(400);
  });

  test("scopes webhooks to their owner for update and delete", async () => {
    const ownerId = await seedUser("Owner");
    const otherId = await seedUser("Intruder");
    const ownerToken = await seedToken(ownerId, "*");
    const otherToken = await seedToken(otherId, "*");

    const createRes = await routeApp.request("/api/webhooks", {
      method: "POST",
      headers: authHeaders(ownerToken),
      body: JSON.stringify({
        url: "https://hooks.example.com/in",
        events: ["share.created"],
      }),
    });
    const created = (await createRes.json()) as { data: { id: string } };
    cleanup.webhookIds.push(created.data.id);

    const crossUpdate = await routeApp.request(
      `/api/webhooks/${created.data.id}`,
      {
        method: "PATCH",
        headers: authHeaders(otherToken),
        body: JSON.stringify({ active: false }),
      }
    );
    expect(crossUpdate.status).toBe(404);

    const crossDelete = await routeApp.request(
      `/api/webhooks/${created.data.id}`,
      {
        method: "DELETE",
        headers: authHeaders(otherToken),
      }
    );
    expect(crossDelete.status).toBe(404);

    const ownerUpdate = await routeApp.request(
      `/api/webhooks/${created.data.id}`,
      {
        method: "PATCH",
        headers: authHeaders(ownerToken),
        body: JSON.stringify({ active: false, events: ["share.revoked"] }),
      }
    );
    const updated = (await ownerUpdate.json()) as {
      data: { active: boolean; events: string[] };
    };
    expect(ownerUpdate.status).toBe(200);
    expect(updated.data.active).toBe(false);
    expect(updated.data.events).toEqual(["share.revoked"]);

    const ownerDelete = await routeApp.request(
      `/api/webhooks/${created.data.id}`,
      {
        method: "DELETE",
        headers: authHeaders(ownerToken),
      }
    );
    expect(ownerDelete.status).toBe(200);

    const remaining = await db
      .select()
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, created.data.id))
      .get();
    expect(remaining).toBeUndefined();
  });

  test("requires webhook:write scope to create", async () => {
    const userId = await seedUser("Reader");
    const readToken = await seedToken(userId, "webhook:read");

    const res = await routeApp.request("/api/webhooks", {
      method: "POST",
      headers: authHeaders(readToken),
      body: JSON.stringify({
        url: "https://hooks.example.com/in",
        events: ["share.created"],
      }),
    });
    expect(res.status).toBe(403);
  });
});
