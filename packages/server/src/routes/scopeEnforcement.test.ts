import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashToken } from "../lib/crypto.js";
import type { AppEnv } from "../lib/types.js";
import repoRoutes from "./repos.js";
import fileRoutes from "./files.js";
import shareRoutes from "./shares.js";
import teamRoutes from "./teams.js";
import userRoutes from "./users.js";
import viewRoutes from "./view.js";
import auditRoutes from "./audit.js";

/**
 * Cross-resource token-scope isolation.
 *
 * These tests prove that an API token scoped narrowly to ONE resource/action
 * cannot drive endpoints belonging to a DIFFERENT resource (or a stronger
 * action), which is the security fix: requireScope is now wired across the
 * repos/files/shares/teams/users/view/audit routers, not just drafts/webhooks/
 * site-data. A `*` token still works everywhere; session auth is unaffected
 * (these tests only exercise the api_token path).
 */

const routeApp = new Hono<AppEnv>();
routeApp.route("/api/repos", repoRoutes);
routeApp.route("/api/files", fileRoutes);
routeApp.route("/api/shares", shareRoutes);
routeApp.route("/api/teams", teamRoutes);
routeApp.route("/api/users", userRoutes);
routeApp.route("/view", viewRoutes);
routeApp.route("/api/audit", auditRoutes);

const cleanup = {
  repoIds: [] as string[],
  userIds: [] as string[],
  tokenIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.tokenIds.length)
    await db
      .delete(schema.apiTokens)
      .where(inArray(schema.apiTokens.id, cleanup.tokenIds))
      .run();
  if (cleanup.repoIds.length)
    await db
      .delete(schema.repos)
      .where(inArray(schema.repos.id, cleanup.repoIds))
      .run();
  if (cleanup.userIds.length)
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, cleanup.userIds))
      .run();
  cleanup.repoIds = [];
  cleanup.userIds = [];
  cleanup.tokenIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
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

describe("token scope: cross-resource isolation", () => {
  test("a draft:read token is rejected on every now-scoped router", async () => {
    const user = await seedUser("Narrow");
    const repoId = await seedUserRepo(user.id);
    const token = await seedToken(user.id, "draft:read");

    // Each of these belongs to a DIFFERENT resource than draft, so the
    // draft-only token must be 403 (scope denied), never 200.
    const probes: Array<[string, RequestInit]> = [
      [`/api/repos/${repoId}/github-sync`, { headers: authHeaders(token) }],
      [`/api/files/${repoId}`, { headers: authHeaders(token) }],
      [`/api/shares`, { headers: authHeaders(token) }],
      [`/api/teams`, { headers: authHeaders(token) }],
      [`/api/users/me`, { headers: authHeaders(token) }],
      [`/view/${repoId}`, { headers: authHeaders(token) }],
      [`/api/audit`, { headers: authHeaders(token) }],
    ];

    for (const [path, init] of probes) {
      const res = await routeApp.request(path, init);
      expect(res.status).toBe(403);
    }
  });

  test("a repo:read token can read repos/files but not write them", async () => {
    const user = await seedUser("RepoReader");
    const repoId = await seedUserRepo(user.id);
    const token = await seedToken(user.id, "repo:read");

    // Read is allowed (200): the repo is owned by this user.
    const read = await routeApp.request(`/api/files/${repoId}`, {
      headers: authHeaders(token),
    });
    expect(read.status).toBe(200);

    // Write (DELETE) is denied by scope BEFORE any handler logic — 403.
    const del = await routeApp.request(`/api/files/${repoId}?path=a.txt`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(del.status).toBe(403);

    // A repo:read token also cannot create a share (share:write resource).
    const share = await routeApp.request(`/api/shares`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ repoId, shareType: "public_link" }),
    });
    expect(share.status).toBe(403);
  });

  test("a repo:write token cannot drive team/share/user/audit endpoints", async () => {
    const user = await seedUser("RepoWriter");
    const token = await seedToken(user.id, "repo:write");

    const team = await routeApp.request(`/api/teams`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ name: "T", slug: "t" }),
    });
    expect(team.status).toBe(403);

    const profile = await routeApp.request(`/api/users/me`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ displayName: "X" }),
    });
    expect(profile.status).toBe(403);

    const audit = await routeApp.request(`/api/audit`, {
      headers: authHeaders(token),
    });
    expect(audit.status).toBe(403);
  });

  test("a wildcard token works across all now-scoped routers", async () => {
    const user = await seedUser("FullAccess");
    const repoId = await seedUserRepo(user.id);
    const token = await seedToken(user.id, "*");

    // None of these should be a scope-403. They resolve on their own merits
    // (200 for owned reads); the point is the scope gate never blocks `*`.
    const reads: string[] = [
      `/api/files/${repoId}`,
      `/api/shares`,
      `/api/teams`,
      `/api/users/me`,
      `/api/audit`,
    ];
    for (const path of reads) {
      const res = await routeApp.request(path, { headers: authHeaders(token) });
      expect(res.status).toBe(200);
    }
  });

  test("resource wildcard (team:*) authorizes both read and write for that resource only", async () => {
    const user = await seedUser("TeamAdmin");
    const token = await seedToken(user.id, "team:*");

    // team read: allowed (empty list for a user with no teams) — not a 403.
    const list = await routeApp.request(`/api/teams`, {
      headers: authHeaders(token),
    });
    expect(list.status).toBe(200);

    // team write: allowed by team:* — a bad body yields a 400 (validation),
    // crucially NOT a 403 (scope). Proves write passed the scope gate.
    const create = await routeApp.request(`/api/teams`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });
    expect(create.status).toBe(400);

    // But team:* must NOT authorize a different resource (repo write).
    const repoId = await seedUserRepo(user.id);
    const del = await routeApp.request(`/api/files/${repoId}?path=a.txt`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(del.status).toBe(403);
  });

  test("audit:read authorizes audit but nothing else", async () => {
    const user = await seedUser("Auditor");
    const token = await seedToken(user.id, "audit:read");

    const audit = await routeApp.request(`/api/audit`, {
      headers: authHeaders(token),
    });
    expect(audit.status).toBe(200);

    const profile = await routeApp.request(`/api/users/me`, {
      headers: authHeaders(token),
    });
    expect(profile.status).toBe(403);
  });
});
