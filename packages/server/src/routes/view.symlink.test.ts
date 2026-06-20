import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashToken } from "../lib/crypto.js";
import { config } from "../lib/config.js";
import type { AppEnv } from "../lib/types.js";
import viewRoutes from "./view.js";

const routeApp = new Hono<AppEnv>();
routeApp.route("/view", viewRoutes);

const cleanup = {
  repoIds: [] as string[],
  userIds: [] as string[],
  tokenIds: [] as string[],
  dirs: [] as string[],
};

afterEach(async () => {
  if (cleanup.tokenIds.length)
    await db
      .delete(schema.apiTokens)
      .where(inArray(schema.apiTokens.id, cleanup.tokenIds))
      .run();
  if (cleanup.repoIds.length) {
    await db
      .delete(schema.files)
      .where(inArray(schema.files.repoId, cleanup.repoIds))
      .run();
    await db
      .delete(schema.repos)
      .where(inArray(schema.repos.id, cleanup.repoIds))
      .run();
  }
  if (cleanup.userIds.length)
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, cleanup.userIds))
      .run();
  await Promise.all(
    cleanup.dirs.map((d) => rm(d, { recursive: true, force: true }))
  );
  cleanup.repoIds = [];
  cleanup.userIds = [];
  cleanup.tokenIds = [];
  cleanup.dirs = [];
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

/**
 * Seed an owned repo and lay out its worktree on disk at the real path view.ts
 * serves from (`${DATA_DIR}/worktrees/${repoId}`), including:
 *   - ok.html        : a normal in-worktree file
 *   - escape.html    : a symlink pointing at an absolute HOST file outside it
 *   - escape-dir     : a symlink to a directory outside the worktree
 * Returns the repoId and the path to the outside secret.
 */
async function seedRepoWithSymlinkWorktree(
  ownerUserId: string
): Promise<{ repoId: string; secretPath: string }> {
  const repoId = testId("repo");

  // An out-of-worktree directory with a host-only secret.
  const outside = await mkdtemp(join(tmpdir(), "ds-host-secret-"));
  cleanup.dirs.push(outside);
  const secretPath = join(outside, "secret.txt");
  await writeFile(secretPath, "TOP SECRET HOST FILE");

  const worktree = join(config.DATA_DIR, "worktrees", repoId);
  cleanup.dirs.push(worktree);
  await mkdir(worktree, { recursive: true });
  await writeFile(join(worktree, "ok.html"), "<h1>ok</h1>");
  // Symlinks that lexically live inside the worktree but escape it.
  await symlink(secretPath, join(worktree, "escape.html"));
  await symlink(outside, join(worktree, "escape-dir"));

  await db.insert(schema.repos).values({
    id: repoId,
    ownerType: "user",
    ownerUserId,
    diskPath: join(outside, "unused.git"),
    headSha: "deadbeef",
  });
  cleanup.repoIds.push(repoId);
  return { repoId, secretPath };
}

describe("view serving refuses symlinks that escape the worktree", () => {
  test("a symlinked file pointing outside the worktree returns 404", async () => {
    const ownerId = await seedUser("Owner");
    const token = await seedToken(ownerId);
    const { repoId } = await seedRepoWithSymlinkWorktree(ownerId);

    const res = await routeApp.request(`/view/${repoId}/escape.html`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain("TOP SECRET HOST FILE");
  });

  test("a path under a symlinked directory escaping the worktree returns 404", async () => {
    const ownerId = await seedUser("Owner");
    const token = await seedToken(ownerId);
    const { repoId } = await seedRepoWithSymlinkWorktree(ownerId);

    const res = await routeApp.request(`/view/${repoId}/escape-dir/secret.txt`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain("TOP SECRET HOST FILE");
  });

  test("a legitimate in-worktree file is still served", async () => {
    const ownerId = await seedUser("Owner");
    const token = await seedToken(ownerId);
    const { repoId } = await seedRepoWithSymlinkWorktree(ownerId);

    const res = await routeApp.request(`/view/${repoId}/ok.html`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ok");
  });
});
