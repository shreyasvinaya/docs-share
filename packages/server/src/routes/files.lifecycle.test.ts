import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashToken } from "../lib/crypto.js";
import { runGit } from "../git/gitOps.js";
import { extractRepoFiles, indexRepoFiles } from "../services/fileExtractor.js";
import type { AppEnv } from "../lib/types.js";
import fileRoutes from "./files.js";

const routeApp = new Hono<AppEnv>();
routeApp.route("/api/files", fileRoutes);

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
 * Build a real bare repo with two commits for `index.html`:
 *   v1: "<h1>One</h1>", v2 (HEAD): "<h1>Two</h1>".
 * Returns the repoId and the sha of the first (v1) commit.
 */
async function seedRepoWithHistory(
  ownerUserId: string
): Promise<{ repoId: string; v1Sha: string; diskPath: string }> {
  const repoId = testId("repo");
  const base = await mkdtemp(join(tmpdir(), "ds-seed-"));
  cleanup.dirs.push(base);
  const diskPath = join(base, "repo.git");
  const work = join(base, "work");

  await runGit(["init", "--bare", diskPath]);
  await runGit(["clone", diskPath, work]);
  await runGit(["-C", work, "config", "user.name", "Seed"]);
  await runGit(["-C", work, "config", "user.email", "seed@example.com"]);

  await Bun.write(join(work, "index.html"), "<h1>One</h1>");
  await runGit(["-C", work, "add", "-A"]);
  await runGit(["-C", work, "commit", "-m", "v1"]);
  const v1 = await runGit(["-C", work, "rev-parse", "HEAD"]);
  const v1Sha = v1.stdout.trim();

  await Bun.write(join(work, "index.html"), "<h1>Two</h1>");
  await runGit(["-C", work, "add", "-A"]);
  await runGit(["-C", work, "commit", "-m", "v2"]);
  await runGit(["-C", work, "push", "origin", "HEAD"]);
  const head = await runGit(["-C", work, "rev-parse", "HEAD"]);

  await db.insert(schema.repos).values({
    id: repoId,
    ownerType: "user",
    ownerUserId,
    diskPath,
    headSha: head.stdout.trim(),
  });
  cleanup.repoIds.push(repoId);

  await extractRepoFiles(repoId, diskPath, head.stdout.trim());
  await indexRepoFiles(repoId, diskPath, head.stdout.trim());

  return { repoId, v1Sha, diskPath };
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

async function readFileAtHead(diskPath: string, path: string): Promise<string> {
  const res = await runGit(["-C", diskPath, "show", `HEAD:${path}`]);
  return res.stdout;
}

describe("file lifecycle routes", () => {
  test("restore reverts a file to a prior commit as a new commit", async () => {
    const ownerId = await seedUser("Owner");
    const token = await seedToken(ownerId);
    const { repoId, v1Sha, diskPath } = await seedRepoWithHistory(ownerId);

    const res = await routeApp.request(`/api/files/${repoId}/restore`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ path: "index.html", sha: v1Sha }),
    });
    const body = (await res.json()) as {
      data: { commitSha: string; path: string };
    };

    expect(res.status).toBe(200);
    // New commit created (HEAD changed, history preserved — v1Sha still old)
    expect(body.data.commitSha).not.toBe(v1Sha);
    expect(body.data.path).toBe("index.html");
    // Content restored to v1
    expect(await readFileAtHead(diskPath, "index.html")).toBe("<h1>One</h1>");

    // History is preserved: the v1 commit still exists.
    const logRes = await runGit([
      "-C",
      diskPath,
      "log",
      "--format=%H",
    ]);
    expect(logRes.stdout).toContain(v1Sha);
    // Three commits now: v1, v2, restore.
    expect(logRes.stdout.trim().split("\n").length).toBe(3);
  });

  test("restore rejects an unknown commit sha", async () => {
    const ownerId = await seedUser("Owner");
    const token = await seedToken(ownerId);
    const { repoId } = await seedRepoWithHistory(ownerId);

    const res = await routeApp.request(`/api/files/${repoId}/restore`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ path: "index.html", sha: "deadbeef" }),
    });

    expect(res.status).toBe(404);
  });

  test("restore requires write access", async () => {
    const ownerId = await seedUser("Owner");
    const intruderId = await seedUser("Intruder");
    const intruderToken = await seedToken(intruderId);
    const { repoId, v1Sha } = await seedRepoWithHistory(ownerId);

    const res = await routeApp.request(`/api/files/${repoId}/restore`, {
      method: "POST",
      headers: {
        ...authHeaders(intruderToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: "index.html", sha: v1Sha }),
    });

    expect(res.status).toBe(403);
  });

  test("copy duplicates a file to a new path within the same repo", async () => {
    const ownerId = await seedUser("Owner");
    const token = await seedToken(ownerId);
    const { repoId, diskPath } = await seedRepoWithHistory(ownerId);

    const res = await routeApp.request(`/api/files/${repoId}/copy`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        sourcePath: "index.html",
        targetPath: "copy.html",
      }),
    });
    const body = (await res.json()) as {
      data: { commitSha: string; targetPath: string };
    };

    expect(res.status).toBe(201);
    expect(body.data.targetPath).toBe("copy.html");
    // Both files exist at HEAD with identical content.
    expect(await readFileAtHead(diskPath, "index.html")).toBe("<h1>Two</h1>");
    expect(await readFileAtHead(diskPath, "copy.html")).toBe("<h1>Two</h1>");

    // The copy is an independent blob in the file index.
    const indexed = await db
      .select()
      .from(schema.files)
      .where(inArray(schema.files.repoId, [repoId]))
      .all();
    const paths = indexed.map((f) => f.path).sort();
    expect(paths).toEqual(["copy.html", "index.html"]);
  });

  test("copy rejects a missing source path", async () => {
    const ownerId = await seedUser("Owner");
    const token = await seedToken(ownerId);
    const { repoId } = await seedRepoWithHistory(ownerId);

    const res = await routeApp.request(`/api/files/${repoId}/copy`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        sourcePath: "missing.html",
        targetPath: "copy.html",
      }),
    });

    expect(res.status).toBe(404);
  });

  test("copy rejects path traversal in target", async () => {
    const ownerId = await seedUser("Owner");
    const token = await seedToken(ownerId);
    const { repoId } = await seedRepoWithHistory(ownerId);

    const res = await routeApp.request(`/api/files/${repoId}/copy`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        sourcePath: "index.html",
        targetPath: "../escape.html",
      }),
    });

    expect(res.status).toBe(400);
  });
});
