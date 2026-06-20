import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashToken } from "../lib/crypto.js";
import type { AppEnv } from "../lib/types.js";
import repoRoutes from "./repos.js";

const routeApp = new Hono<AppEnv>();
routeApp.route("/api/repos", repoRoutes);

const cleanup = {
  repoIds: [] as string[],
  userIds: [] as string[],
  tokenIds: [] as string[],
  shareIds: [] as string[],
  teamIds: [] as string[],
  memberIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.tokenIds.length)
    await db
      .delete(schema.apiTokens)
      .where(inArray(schema.apiTokens.id, cleanup.tokenIds))
      .run();
  if (cleanup.shareIds.length) {
    await db
      .delete(schema.shareRecipients)
      .where(inArray(schema.shareRecipients.shareId, cleanup.shareIds))
      .run();
    await db
      .delete(schema.shares)
      .where(inArray(schema.shares.id, cleanup.shareIds))
      .run();
  }
  if (cleanup.memberIds.length)
    await db
      .delete(schema.teamMembers)
      .where(inArray(schema.teamMembers.id, cleanup.memberIds))
      .run();
  if (cleanup.repoIds.length)
    await db
      .delete(schema.repos)
      .where(inArray(schema.repos.id, cleanup.repoIds))
      .run();
  if (cleanup.teamIds.length)
    await db
      .delete(schema.teams)
      .where(inArray(schema.teams.id, cleanup.teamIds))
      .run();
  if (cleanup.userIds.length)
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, cleanup.userIds))
      .run();
  cleanup.repoIds = [];
  cleanup.userIds = [];
  cleanup.tokenIds = [];
  cleanup.shareIds = [];
  cleanup.teamIds = [];
  cleanup.memberIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

async function seedUser(label: string): Promise<{ id: string; email: string }> {
  const userId = testId(`user_${label}`);
  const email = `${userId}@example.com`;
  await db.insert(schema.users).values({
    id: userId,
    email,
    displayName: label,
    googleId: `google_${userId}`,
  });
  cleanup.userIds.push(userId);
  return { id: userId, email };
}

async function seedToken(userId: string): Promise<string> {
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
  return token;
}

async function seedUserRepo(ownerUserId: string): Promise<string> {
  const repoId = testId("repo");
  await db.insert(schema.repos).values({
    id: repoId,
    ownerType: "user",
    ownerUserId,
    diskPath: `/tmp/${repoId}.git`,
  });
  cleanup.repoIds.push(repoId);
  return repoId;
}

async function seedScopedShare(opts: {
  repoId: string;
  createdById: string;
  recipientUserId: string;
  recipientEmail: string;
  permission: "read" | "write";
  path: string | null;
}): Promise<void> {
  const shareId = testId("share");
  await db.insert(schema.shares).values({
    id: shareId,
    repoId: opts.repoId,
    path: opts.path,
    createdById: opts.createdById,
    shareType: "email",
    permission: opts.permission,
  });
  await db.insert(schema.shareRecipients).values({
    id: testId("rcp"),
    shareId,
    email: opts.recipientEmail,
    userId: opts.recipientUserId,
  });
  cleanup.shareIds.push(shareId);
}

describe("github-sync repo-wide authorization", () => {
  test("owner can read github-sync config", async () => {
    const owner = await seedUser("Owner");
    const token = await seedToken(owner.id);
    const repoId = await seedUserRepo(owner.id);

    const res = await routeApp.request(
      `/api/repos/${repoId}/github-sync`,
      { headers: authHeaders(token) }
    );
    expect(res.status).toBe(200);
  });

  test("a path-scoped write share holder is denied github-sync config", async () => {
    const owner = await seedUser("Owner");
    const scoped = await seedUser("Scoped");
    const scopedToken = await seedToken(scoped.id);
    const repoId = await seedUserRepo(owner.id);
    await seedScopedShare({
      repoId,
      createdById: owner.id,
      recipientUserId: scoped.id,
      recipientEmail: scoped.email,
      permission: "write",
      path: "docs",
    });

    const res = await routeApp.request(
      `/api/repos/${repoId}/github-sync`,
      { headers: authHeaders(scopedToken) }
    );
    expect(res.status).toBe(403);
  });

  test("a path-scoped write share holder is denied configuring a github-sync", async () => {
    const owner = await seedUser("Owner");
    const scoped = await seedUser("Scoped");
    const scopedToken = await seedToken(scoped.id);
    const repoId = await seedUserRepo(owner.id);
    await seedScopedShare({
      repoId,
      createdById: owner.id,
      recipientUserId: scoped.id,
      recipientEmail: scoped.email,
      permission: "write",
      path: "docs",
    });

    const res = await routeApp.request(`/api/repos/${repoId}/github-sync`, {
      method: "POST",
      headers: { ...authHeaders(scopedToken), "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl: "https://github.com/owner/repo" }),
    });
    expect(res.status).toBe(403);
  });

  test("a whole-repo write share holder may read github-sync config", async () => {
    const owner = await seedUser("Owner");
    const writer = await seedUser("Writer");
    const writerToken = await seedToken(writer.id);
    const repoId = await seedUserRepo(owner.id);
    await seedScopedShare({
      repoId,
      createdById: owner.id,
      recipientUserId: writer.id,
      recipientEmail: writer.email,
      permission: "write",
      path: null,
    });

    const res = await routeApp.request(
      `/api/repos/${repoId}/github-sync`,
      { headers: authHeaders(writerToken) }
    );
    expect(res.status).toBe(200);
  });
});
