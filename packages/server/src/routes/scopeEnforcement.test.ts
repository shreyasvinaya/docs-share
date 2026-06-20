import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { hashToken } from "../lib/crypto.js";
import { sessionMiddleware } from "../middleware/session.js";
import type { AppEnv } from "../lib/types.js";
import repoRoutes from "./repos.js";
import fileRoutes from "./files.js";
import shareRoutes from "./shares.js";
import teamRoutes from "./teams.js";
import userRoutes from "./users.js";
import viewRoutes from "./view.js";
import auditRoutes from "./audit.js";
import projectRoutes from "./projects.js";
import adminRoutes from "./admin.js";
import setupRoutes from "./setup.js";
import internalRoutes from "./internal.js";

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
// Resolve session cookies first so we can prove session auth bypasses scopes.
routeApp.use("*", sessionMiddleware);
routeApp.route("/api/repos", repoRoutes);
routeApp.route("/api/files", fileRoutes);
routeApp.route("/api/shares", shareRoutes);
routeApp.route("/api/teams", teamRoutes);
routeApp.route("/api/users", userRoutes);
routeApp.route("/view", viewRoutes);
routeApp.route("/api/audit", auditRoutes);
routeApp.route("/api/projects", projectRoutes);
routeApp.route("/api/admin", adminRoutes);
routeApp.route("/api/setup", setupRoutes);
routeApp.route("/internal", internalRoutes);

const cleanup = {
  repoIds: [] as string[],
  userIds: [] as string[],
  tokenIds: [] as string[],
  sessionIds: [] as string[],
  sysadminEmails: null as string | null,
};

afterEach(async () => {
  if (cleanup.sysadminEmails !== null) {
    config.SYSADMIN_EMAILS = cleanup.sysadminEmails;
    cleanup.sysadminEmails = null;
  }
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
  cleanup.sessionIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function seedUser(
  label: string,
  role: "user" | "sysadmin" = "user"
): Promise<{ id: string; email: string }> {
  const userId = testId(`user_${label}`);
  const email = `${userId}@example.com`;
  await db.insert(schema.users).values({
    id: userId,
    email,
    displayName: label,
    googleId: `google_${userId}`,
    role,
  });
  cleanup.userIds.push(userId);
  return { id: userId, email };
}

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

/** Make the given email authoritative via SYSADMIN_EMAILS (restored after). */
function makeSysadmin(email: string): void {
  if (cleanup.sysadminEmails === null) {
    cleanup.sysadminEmails = config.SYSADMIN_EMAILS;
  }
  config.SYSADMIN_EMAILS = email;
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

describe("token scope: projects router (newly scoped)", () => {
  test("project:read reads but cannot write; unrelated scope is rejected", async () => {
    const user = await seedUser("Projects");
    const readToken = await seedToken(user.id, "project:read");

    // Read is allowed (own projects -> 200, never a scope-403).
    const list = await routeApp.request(`/api/projects`, {
      headers: authHeaders(readToken),
    });
    expect(list.status).toBe(200);

    // Write (POST) is denied for a read-only token by scope -> 403.
    const create = await routeApp.request(`/api/projects`, {
      method: "POST",
      headers: authHeaders(readToken),
      body: JSON.stringify({ name: "P", slug: "p", ownerType: "user" }),
    });
    expect(create.status).toBe(403);

    // A token scoped to a different resource cannot read projects at all.
    const wrongToken = await seedToken(user.id, "repo:read");
    const denied = await routeApp.request(`/api/projects`, {
      headers: authHeaders(wrongToken),
    });
    expect(denied.status).toBe(403);
  });

  test("project:write passes the scope gate for POST (validation, not 403)", async () => {
    const user = await seedUser("ProjectWriter");
    const token = await seedToken(user.id, "project:write");

    // A bad body yields 400 (validation) — crucially NOT 403 (scope), proving
    // write cleared the scope gate.
    const res = await routeApp.request(`/api/projects`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("token scope: admin/setup routers (sysadmin + admin scope)", () => {
  test("a sysadmin token without admin scope cannot drive admin/setup", async () => {
    const user = await seedUser("ScopedAdmin", "sysadmin");
    makeSysadmin(user.email);
    // Sysadmin user, but the TOKEN is scoped to an unrelated resource. The extra
    // admin-scope gate must still block it even though requireSysadmin passes.
    const token = await seedToken(user.id, "repo:read");

    const users = await routeApp.request(`/api/admin/users`, {
      headers: authHeaders(token),
    });
    expect(users.status).toBe(403);

    const branding = await routeApp.request(`/api/admin/branding`, {
      headers: authHeaders(token),
    });
    expect(branding.status).toBe(403);

    const status = await routeApp.request(`/api/setup/status`, {
      headers: authHeaders(token),
    });
    expect(status.status).toBe(403);
  });

  test("admin:read authorizes admin reads but not admin writes", async () => {
    const user = await seedUser("AdminReader", "sysadmin");
    makeSysadmin(user.email);
    const token = await seedToken(user.id, "admin:read");

    const users = await routeApp.request(`/api/admin/users`, {
      headers: authHeaders(token),
    });
    expect(users.status).toBe(200);

    const status = await routeApp.request(`/api/setup/status`, {
      headers: authHeaders(token),
    });
    expect(status.status).toBe(200);

    // admin:read must NOT satisfy the write requirement on PATCH.
    const patch = await routeApp.request(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ role: "user" }),
    });
    expect(patch.status).toBe(403);
  });

  test("setup/branding is public (no auth, no scope)", async () => {
    const res = await routeApp.request(`/api/setup/branding`);
    expect(res.status).toBe(200);
  });
});

describe("token scope: internal repo-lookup", () => {
  test("internal /repo requires repo:read; an unrelated scope is rejected", async () => {
    const user = await seedUser("InternalUser");
    const repoId = await seedUserRepo(user.id);

    // A draft-only token cannot use the internal repo lookup.
    const wrong = await seedToken(user.id, "draft:read");
    const denied = await routeApp.request(
      `/internal/repo?ownerType=user&ownerId=${user.id}`,
      { headers: authHeaders(wrong) }
    );
    expect(denied.status).toBe(403);

    // A repo:read token clears the scope gate (own repo -> 200).
    const ok = await seedToken(user.id, "repo:read");
    const allowed = await routeApp.request(
      `/internal/repo?ownerType=user&ownerId=${user.id}`,
      { headers: authHeaders(ok) }
    );
    expect(allowed.status).toBe(200);
    expect(repoId).toBeTruthy();
  });
});

describe("token scope: user read/write single-gate (no double-gate)", () => {
  test("user:read can GET /me but not PATCH it", async () => {
    const user = await seedUser("UserReader");
    const token = await seedToken(user.id, "user:read");

    const me = await routeApp.request(`/api/users/me`, {
      headers: authHeaders(token),
    });
    expect(me.status).toBe(200);

    const patch = await routeApp.request(`/api/users/me`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ displayName: "X" }),
    });
    expect(patch.status).toBe(403);
  });

  test("user:write reaches github-app install WITHOUT needing user:read", async () => {
    const user = await seedUser("UserWriter");
    // The install GET mutates the connection and requires ONLY user:write. With
    // the old blanket read-gate this token would have been wrongly 403'd.
    const token = await seedToken(user.id, "user:write");

    const res = await routeApp.request(`/api/users/me/github-app/install`, {
      headers: authHeaders(token),
      redirect: "manual",
    });
    // NOT a scope-403: it clears the gate. Without GitHub App configured it
    // returns 503; if configured it 302-redirects. Either proves scope passed.
    expect(res.status).not.toBe(403);
    expect([302, 503]).toContain(res.status);

    // But a user:write token must NOT be able to read /me (single-gate: read
    // needs user:read, not satisfied by user:write).
    const me = await routeApp.request(`/api/users/me`, {
      headers: authHeaders(token),
    });
    expect(me.status).toBe(403);
  });
});

describe("session auth bypasses scope enforcement", () => {
  test("a cookie session can read and write regardless of any scope", async () => {
    const user = await seedUser("SessionUser");
    const sessionId = await seedSession(user.id);
    const repoId = await seedUserRepo(user.id);

    // Reads succeed.
    const me = await routeApp.request(`/api/users/me`, {
      headers: { Cookie: `ds_session=${sessionId}` },
    });
    expect(me.status).toBe(200);

    // A write that would require a scope for a token (PATCH /me) also succeeds —
    // sessions are never scope-gated.
    const patch = await routeApp.request(`/api/users/me`, {
      method: "PATCH",
      headers: {
        Cookie: `ds_session=${sessionId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ displayName: "Renamed" }),
    });
    expect(patch.status).toBe(200);

    // A files read on an owned repo also succeeds with no token scope at all.
    const files = await routeApp.request(`/api/files/${repoId}`, {
      headers: { Cookie: `ds_session=${sessionId}` },
    });
    expect(files.status).toBe(200);
  });
});
