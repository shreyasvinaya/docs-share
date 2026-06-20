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
  shareIds: [] as string[],
  dirs: [] as string[],
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
  cleanup.shareIds = [];
  cleanup.dirs = [];
});

/**
 * Grant `recipientUserId` an email-share of `permission` on `repoId`, scoped to
 * `path` (null = whole repo). Returns the share id.
 */
async function seedEmailShare(opts: {
  repoId: string;
  createdById: string;
  recipientUserId: string;
  recipientEmail: string;
  permission: "read" | "write";
  path: string | null;
}): Promise<string> {
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
    id: testId("recipient"),
    shareId,
    email: opts.recipientEmail,
    userId: opts.recipientUserId,
  });
  cleanup.shareIds.push(shareId);
  return shareId;
}

async function userEmail(userId: string): Promise<string> {
  const row = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(inArray(schema.users.id, [userId]))
    .get();
  return row!.email;
}

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

/**
 * Build a repo with two top-level areas across two commits:
 *   docs/page.html and root.html. v1 has "<h1>One</h1>" in docs/page.html;
 *   HEAD (v2) has "<h1>Two</h1>". Returns repoId + the v1 sha.
 */
async function seedRepoWithDocs(
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

  await Bun.write(join(work, "docs", "page.html"), "<h1>One</h1>");
  await Bun.write(join(work, "root.html"), "<p>root</p>");
  await runGit(["-C", work, "add", "-A"]);
  await runGit(["-C", work, "commit", "-m", "v1"]);
  const v1 = await runGit(["-C", work, "rev-parse", "HEAD"]);
  const v1Sha = v1.stdout.trim();

  await Bun.write(join(work, "docs", "page.html"), "<h1>Two</h1>");
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

/**
 * Build an owned bare repo whose tree contains `files` (path -> content), each
 * committed once. Returns the repoId + diskPath.
 */
async function seedRepoWithFiles(
  ownerUserId: string,
  files: Record<string, string>
): Promise<{ repoId: string; diskPath: string }> {
  const repoId = testId("repo");
  const base = await mkdtemp(join(tmpdir(), "ds-seed-"));
  cleanup.dirs.push(base);
  const diskPath = join(base, "repo.git");
  const work = join(base, "work");

  await runGit(["init", "--bare", diskPath]);
  await runGit(["clone", diskPath, work]);
  await runGit(["-C", work, "config", "user.name", "Seed"]);
  await runGit(["-C", work, "config", "user.email", "seed@example.com"]);

  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(work, path), content);
  }
  await runGit(["-C", work, "add", "-A"]);
  await runGit(["-C", work, "commit", "-m", "seed"]);
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

  return { repoId, diskPath };
}

/** Build an empty, owned bare repo (no commits). Returns repoId + diskPath. */
async function seedEmptyRepo(
  ownerUserId: string
): Promise<{ repoId: string; diskPath: string }> {
  const repoId = testId("repo");
  const base = await mkdtemp(join(tmpdir(), "ds-seed-"));
  cleanup.dirs.push(base);
  const diskPath = join(base, "repo.git");
  await runGit(["init", "--bare", diskPath]);
  await db.insert(schema.repos).values({
    id: repoId,
    ownerType: "user",
    ownerUserId,
    diskPath,
    headSha: null,
  });
  cleanup.repoIds.push(repoId);
  return { repoId, diskPath };
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

  test("a path-scoped write share cannot restore the whole repo, but the owner can", async () => {
    const ownerId = await seedUser("Owner");
    const scopedId = await seedUser("ScopedWriter");
    const scopedToken = await seedToken(scopedId);
    const { repoId, v1Sha } = await seedRepoWithDocs(ownerId);

    // Grant ScopedWriter a WRITE share scoped to docs/ only.
    await seedEmailShare({
      repoId,
      createdById: ownerId,
      recipientUserId: scopedId,
      recipientEmail: await userEmail(scopedId),
      permission: "write",
      path: "docs",
    });

    // Whole-repo restore (no path) must be denied for the scoped writer.
    const wholeRepo = await routeApp.request(`/api/files/${repoId}/restore`, {
      method: "POST",
      headers: {
        ...authHeaders(scopedToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sha: v1Sha }),
    });
    expect(wholeRepo.status).toBe(403);

    // A restore inside docs/ is allowed for the scoped writer.
    const scoped = await routeApp.request(`/api/files/${repoId}/restore`, {
      method: "POST",
      headers: {
        ...authHeaders(scopedToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sha: v1Sha, path: "docs/page.html" }),
    });
    expect(scoped.status).toBe(200);

    // The owner CAN restore the whole repo.
    const ownerToken = await seedToken(ownerId);
    const ownerWhole = await routeApp.request(`/api/files/${repoId}/restore`, {
      method: "POST",
      headers: {
        ...authHeaders(ownerToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sha: v1Sha }),
    });
    expect(ownerWhole.status).toBe(200);
  });

  test("a path-scoped write share cannot copy outside its path", async () => {
    const ownerId = await seedUser("Owner");
    const scopedId = await seedUser("ScopedWriter");
    const scopedToken = await seedToken(scopedId);
    const { repoId } = await seedRepoWithDocs(ownerId);

    await seedEmailShare({
      repoId,
      createdById: ownerId,
      recipientUserId: scopedId,
      recipientEmail: await userEmail(scopedId),
      permission: "write",
      path: "docs",
    });

    // Copying into docs/ (write covered) and reading from docs/ is allowed.
    const allowed = await routeApp.request(`/api/files/${repoId}/copy`, {
      method: "POST",
      headers: {
        ...authHeaders(scopedToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourcePath: "docs/page.html",
        targetPath: "docs/page-copy.html",
      }),
    });
    expect(allowed.status).toBe(201);

    // Writing OUTSIDE docs/ (root) must be denied even though source is readable.
    const denied = await routeApp.request(`/api/files/${repoId}/copy`, {
      method: "POST",
      headers: {
        ...authHeaders(scopedToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourcePath: "docs/page.html",
        targetPath: "escaped.html",
      }),
    });
    expect(denied.status).toBe(403);
  });

  test("cross-repo copy authorizes target write consistently", async () => {
    const ownerId = await seedUser("Owner");
    const otherOwnerId = await seedUser("OtherOwner");
    const ownerToken = await seedToken(ownerId);
    const { repoId, diskPath } = await seedRepoWithHistory(ownerId);
    // Destination repo owned by a DIFFERENT user.
    const { repoId: destRepoId } = await seedEmptyRepo(otherOwnerId);

    // Owner of source has no write on dest -> 403, identical check as same-repo.
    const denied = await routeApp.request(`/api/files/${repoId}/copy`, {
      method: "POST",
      headers: {
        ...authHeaders(ownerToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourcePath: "index.html",
        targetPath: "index.html",
        targetRepoId: destRepoId,
      }),
    });
    expect(denied.status).toBe(403);

    // Grant the source owner a whole-repo WRITE share on the destination.
    await seedEmailShare({
      repoId: destRepoId,
      createdById: otherOwnerId,
      recipientUserId: ownerId,
      recipientEmail: await userEmail(ownerId),
      permission: "write",
      path: null,
    });

    const ok = await routeApp.request(`/api/files/${repoId}/copy`, {
      method: "POST",
      headers: {
        ...authHeaders(ownerToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourcePath: "index.html",
        targetPath: "index.html",
        targetRepoId: destRepoId,
      }),
    });
    const okBody = (await ok.json()) as {
      data: { targetRepoId: string };
    };
    expect(ok.status).toBe(201);
    expect(okBody.data.targetRepoId).toBe(destRepoId);
    // Source repo unchanged; copy landed in the destination repo.
    expect(await readFileAtHead(diskPath, "index.html")).toBe("<h1>Two</h1>");
  });

  test("restore fails cleanly when git rejects a bad revision", async () => {
    const ownerId = await seedUser("Owner");
    const token = await seedToken(ownerId);
    const { repoId } = await seedRepoWithHistory(ownerId);

    // A sha-shaped value that does not exist: git cat-file exits non-zero and
    // the handler returns 404 rather than trusting the (empty) output.
    const res = await routeApp.request(`/api/files/${repoId}/restore`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ sha: "abcdef0", path: "index.html" }),
    });

    expect(res.status).toBe(404);
  });

  test("copy fails cleanly when the source repo is empty (bad git read)", async () => {
    const ownerId = await seedUser("Owner");
    const token = await seedToken(ownerId);
    // Empty source repo: readTrackedFiles' git ls-tree exits non-zero (no HEAD),
    // which surfaces as a clean 500 instead of a false success.
    const { repoId } = await seedEmptyRepo(ownerId);

    const res = await routeApp.request(`/api/files/${repoId}/copy`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        sourcePath: "index.html",
        targetPath: "copy.html",
      }),
    });

    expect(res.status).toBe(500);
  });
});

describe("path-scoped share authorization on file routes", () => {
  /** Grant `userId` a path-scoped read share on docs/ for a docs repo. */
  async function seedDocsRepoWithScopedReader(
    permission: "read" | "write"
  ): Promise<{ repoId: string; ownerId: string; scopedId: string; scopedToken: string }> {
    const ownerId = await seedUser("Owner");
    const scopedId = await seedUser("Scoped");
    const scopedToken = await seedToken(scopedId);
    const { repoId } = await seedRepoWithDocs(ownerId);
    await seedEmailShare({
      repoId,
      createdById: ownerId,
      recipientUserId: scopedId,
      recipientEmail: await userEmail(scopedId),
      permission,
      path: "docs",
    });
    return { repoId, ownerId, scopedId, scopedToken };
  }

  test("path-scoped reader is denied the repo-root file list", async () => {
    const { repoId, scopedToken } = await seedDocsRepoWithScopedReader("read");

    const res = await routeApp.request(`/api/files/${repoId}`, {
      headers: authHeaders(scopedToken),
    });
    expect(res.status).toBe(403);
  });

  test("path-scoped reader can list within their path", async () => {
    const { repoId, scopedToken } = await seedDocsRepoWithScopedReader("read");

    const res = await routeApp.request(`/api/files/${repoId}?path=docs`, {
      headers: authHeaders(scopedToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ path: string }> };
    expect(body.data.some((n) => n.path === "docs/page.html")).toBe(true);
  });

  test("path-scoped reader is denied the repo-root commit log but allowed within their path", async () => {
    const { repoId, scopedToken } = await seedDocsRepoWithScopedReader("read");

    const wholeRepo = await routeApp.request(`/api/files/${repoId}/commits`, {
      headers: authHeaders(scopedToken),
    });
    expect(wholeRepo.status).toBe(403);

    const scoped = await routeApp.request(
      `/api/files/${repoId}/commits?path=docs/page.html`,
      { headers: authHeaders(scopedToken) }
    );
    expect(scoped.status).toBe(200);
  });

  test("owner can list the repo root and read the whole-repo commit log", async () => {
    const ownerId = await seedUser("Owner");
    const ownerToken = await seedToken(ownerId);
    const { repoId } = await seedRepoWithDocs(ownerId);

    const list = await routeApp.request(`/api/files/${repoId}`, {
      headers: authHeaders(ownerToken),
    });
    expect(list.status).toBe(200);

    const commits = await routeApp.request(`/api/files/${repoId}/commits`, {
      headers: authHeaders(ownerToken),
    });
    expect(commits.status).toBe(200);
  });

  test("path-scoped writer is denied delete outside their path but allowed inside", async () => {
    const { repoId, diskPath, scopedToken } = await (async () => {
      const seeded = await seedDocsRepoWithScopedReader("write");
      const repo = await db
        .select()
        .from(schema.repos)
        .where(inArray(schema.repos.id, [seeded.repoId]))
        .get();
      return { ...seeded, diskPath: repo!.diskPath };
    })();

    // Deleting root.html (outside docs/) is denied.
    const denied = await routeApp.request(
      `/api/files/${repoId}?path=root.html`,
      { method: "DELETE", headers: authHeaders(scopedToken) }
    );
    expect(denied.status).toBe(403);

    // Deleting docs/page.html (inside scope) is allowed.
    const allowed = await routeApp.request(
      `/api/files/${repoId}?path=docs/page.html`,
      { method: "DELETE", headers: authHeaders(scopedToken) }
    );
    expect(allowed.status).toBe(200);
    // root.html still present; docs/page.html removed at HEAD.
    expect(await readFileAtHead(diskPath, "root.html")).toBe("<p>root</p>");
  });

  test("path-scoped writer is denied upload outside their path but allowed inside", async () => {
    const { repoId, scopedToken } = await seedDocsRepoWithScopedReader("write");

    // Upload OUTSIDE docs/ (root destination) is denied.
    const deniedForm = new FormData();
    deniedForm.set("path", "");
    deniedForm.set(
      "file",
      new File(["<p>nope</p>"], "evil.html", { type: "text/html" })
    );
    const denied = await routeApp.request(`/api/files/${repoId}/upload`, {
      method: "POST",
      headers: authHeaders(scopedToken),
      body: deniedForm,
    });
    expect(denied.status).toBe(403);

    // Upload INSIDE docs/ is allowed.
    const allowedForm = new FormData();
    allowedForm.set("path", "docs");
    allowedForm.set(
      "file",
      new File(["<p>ok</p>"], "added.html", { type: "text/html" })
    );
    const allowed = await routeApp.request(`/api/files/${repoId}/upload`, {
      method: "POST",
      headers: authHeaders(scopedToken),
      body: allowedForm,
    });
    expect(allowed.status).toBe(201);
  });
});

describe("git pathspec-magic is rejected on file routes", () => {
  test("DELETE with `:(glob)**` is rejected and deletes nothing outside the path", async () => {
    const ownerId = await seedUser("Owner");
    const token = await seedToken(ownerId);
    // Two top-level areas; a pathspec-magic glob would match BOTH if it leaked
    // through to `git ls-files`/`git rm`.
    const { repoId, diskPath } = await seedRepoWithFiles(ownerId, {
      "docs/page.html": "<p>docs</p>",
      "root.html": "<p>root</p>",
    });

    for (const magic of [":(glob)**", ":(top)", ":(exclude)docs", ":/"]) {
      const res = await routeApp.request(
        `/api/files/${repoId}?path=${encodeURIComponent(magic)}`,
        { method: "DELETE", headers: authHeaders(token) }
      );
      // normalizeRelativePath returns null -> handler 400s before any git runs.
      expect(res.status).toBe(400);
    }

    // Nothing was deleted: BOTH files are still present at HEAD.
    expect(await readFileAtHead(diskPath, "docs/page.html")).toBe("<p>docs</p>");
    expect(await readFileAtHead(diskPath, "root.html")).toBe("<p>root</p>");

    // The file index is untouched too.
    const indexed = await db
      .select()
      .from(schema.files)
      .where(inArray(schema.files.repoId, [repoId]))
      .all();
    expect(indexed.map((f) => f.path).sort()).toEqual([
      "docs/page.html",
      "root.html",
    ]);
  });

  test("commits with a pathspec-magic ?path is rejected (400)", async () => {
    const ownerId = await seedUser("Owner");
    const token = await seedToken(ownerId);
    const { repoId } = await seedRepoWithFiles(ownerId, {
      "docs/page.html": "<p>docs</p>",
      "root.html": "<p>root</p>",
    });

    const res = await routeApp.request(
      `/api/files/${repoId}/commits?path=${encodeURIComponent(":(glob)**")}`,
      { headers: authHeaders(token) }
    );
    expect(res.status).toBe(400);
  });

  test("a scoped DELETE still works for a legitimate path", async () => {
    const ownerId = await seedUser("Owner");
    const token = await seedToken(ownerId);
    const { repoId, diskPath } = await seedRepoWithFiles(ownerId, {
      "docs/page.html": "<p>docs</p>",
      "root.html": "<p>root</p>",
    });

    const res = await routeApp.request(
      `/api/files/${repoId}?path=docs/page.html`,
      { method: "DELETE", headers: authHeaders(token) }
    );
    expect(res.status).toBe(200);
    // Only the targeted file is gone; the sibling remains.
    expect(await readFileAtHead(diskPath, "root.html")).toBe("<p>root</p>");
  });
});

describe("file listing treats the path prefix literally (LIKE wildcards)", () => {
  test("a read share scoped to literal `a_b` does not list sibling `axb`", async () => {
    const ownerId = await seedUser("Owner");
    const scopedId = await seedUser("Scoped");
    const scopedToken = await seedToken(scopedId);
    // `_` is a LIKE single-char wildcard: a `a_b/%` pattern would match `axb/`.
    const { repoId } = await seedRepoWithFiles(ownerId, {
      "a_b/inside.html": "<p>inside</p>",
      "axb/sibling.html": "<p>sibling</p>",
      "aZb/other.html": "<p>other</p>",
    });
    await seedEmailShare({
      repoId,
      createdById: ownerId,
      recipientUserId: scopedId,
      recipientEmail: await userEmail(scopedId),
      permission: "read",
      path: "a_b",
    });

    const res = await routeApp.request(`/api/files/${repoId}?path=a_b`, {
      headers: authHeaders(scopedToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ path: string }> };
    const paths = body.data.map((n) => n.path);
    // Only the literal a_b/ subtree is listed; siblings must NOT leak.
    expect(paths).toContain("a_b/inside.html");
    expect(paths).not.toContain("axb/sibling.html");
    expect(paths).not.toContain("aZb/other.html");
  });

  test("a read share scoped to literal `a%b` does not list sibling `aZZb`", async () => {
    const ownerId = await seedUser("Owner");
    const scopedId = await seedUser("Scoped");
    const scopedToken = await seedToken(scopedId);
    // `%` is a LIKE any-run wildcard: a `a%b/%` pattern would match `aZZb/`.
    const { repoId } = await seedRepoWithFiles(ownerId, {
      "a%b/inside.html": "<p>inside</p>",
      "aZZb/sibling.html": "<p>sibling</p>",
    });
    await seedEmailShare({
      repoId,
      createdById: ownerId,
      recipientUserId: scopedId,
      recipientEmail: await userEmail(scopedId),
      permission: "read",
      path: "a%b",
    });

    const res = await routeApp.request(
      `/api/files/${repoId}?path=${encodeURIComponent("a%b")}`,
      { headers: authHeaders(scopedToken) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ path: string }> };
    const paths = body.data.map((n) => n.path);
    expect(paths).toContain("a%b/inside.html");
    expect(paths).not.toContain("aZZb/sibling.html");
  });
});
