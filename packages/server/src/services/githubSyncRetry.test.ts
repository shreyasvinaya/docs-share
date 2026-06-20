import { afterEach, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { retryFailedGitHubSyncs } from "./githubSyncRetry.js";

const cleanup = {
  syncIds: [] as string[],
  repoIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.syncIds.length)
    await db.delete(schema.githubSyncs).where(inArray(schema.githubSyncs.id, cleanup.syncIds)).run();
  if (cleanup.repoIds.length)
    await db.delete(schema.repos).where(inArray(schema.repos.id, cleanup.repoIds)).run();
  if (cleanup.userIds.length)
    await db.delete(schema.users).where(inArray(schema.users.id, cleanup.userIds)).run();
  cleanup.syncIds = [];
  cleanup.repoIds = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function seedSync(status: "idle" | "syncing" | "success" | "error"): Promise<{
  syncId: string;
  repoId: string;
}> {
  const userId = testId("user");
  const repoId = testId("repo");
  const syncId = testId("sync");

  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: "User",
    googleId: `g_${userId}`,
  });
  await db.insert(schema.repos).values({
    id: repoId,
    ownerType: "user",
    ownerUserId: userId,
    diskPath: `/tmp/${repoId}.git`,
  });
  await db.insert(schema.githubSyncs).values({
    id: syncId,
    repoId,
    repoUrl: "https://github.com/acme/site.git",
    branch: "main",
    sourcePath: "",
    status,
    error: status === "error" ? "boom" : null,
  });

  cleanup.userIds.push(userId);
  cleanup.repoIds.push(repoId);
  cleanup.syncIds.push(syncId);
  return { syncId, repoId };
}

describe("retryFailedGitHubSyncs", () => {
  test("retries only failed syncs and marks them success when the runner succeeds", async () => {
    const failed = await seedSync("error");
    const ok = await seedSync("success");

    const seen: string[] = [];
    const result = await retryFailedGitHubSyncs(10, async (repo) => {
      seen.push(repo.id);
      return { commitSha: "abc123", syncedAt: new Date().toISOString() };
    });

    expect(seen).toEqual([failed.repoId]);
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    const row = await db
      .select()
      .from(schema.githubSyncs)
      .where(eq(schema.githubSyncs.id, failed.syncId))
      .get();
    expect(row?.status).toBe("success");
    expect(row?.lastCommitSha).toBe("abc123");
    expect(row?.error).toBeNull();

    const untouched = await db
      .select()
      .from(schema.githubSyncs)
      .where(eq(schema.githubSyncs.id, ok.syncId))
      .get();
    expect(untouched?.status).toBe("success");
  });

  test("keeps the row in error state and records the message when the runner throws", async () => {
    const failed = await seedSync("error");

    const result = await retryFailedGitHubSyncs(10, async () => {
      throw new Error("still broken");
    });

    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);

    const row = await db
      .select()
      .from(schema.githubSyncs)
      .where(eq(schema.githubSyncs.id, failed.syncId))
      .get();
    expect(row?.status).toBe("error");
    expect(row?.error).toBe("still broken");
  });

  test("honours the batch limit", async () => {
    await seedSync("error");
    await seedSync("error");
    await seedSync("error");

    let calls = 0;
    const result = await retryFailedGitHubSyncs(2, async () => {
      calls += 1;
      return { commitSha: "x", syncedAt: new Date().toISOString() };
    });

    expect(calls).toBe(2);
    expect(result.attempted).toBe(2);
  });

  test("redacts credentials from the persisted error message", async () => {
    const failed = await seedSync("error");

    await retryFailedGitHubSyncs(10, async () => {
      throw new Error(
        "fatal: Authentication failed for https://x-access-token:ghp_supersecret@github.com/acme/private.git"
      );
    });

    const row = await db
      .select()
      .from(schema.githubSyncs)
      .where(eq(schema.githubSyncs.id, failed.syncId))
      .get();
    expect(row?.error).not.toContain("ghp_supersecret");
    expect(row?.error).toContain("[redacted]");
  });

  test("stops retrying and marks the sync failed once max retries is reached", async () => {
    const failed = await seedSync("error");
    const maxRetries = 3;

    // Each pass throws, so the row accrues one retry per pass until the budget
    // is exhausted, after which it must be excluded from selection.
    for (let i = 0; i < maxRetries; i += 1) {
      await retryFailedGitHubSyncs(
        10,
        async () => {
          throw new Error("still broken");
        },
        maxRetries
      );
    }

    const row = await db
      .select()
      .from(schema.githubSyncs)
      .where(eq(schema.githubSyncs.id, failed.syncId))
      .get();
    expect(row?.status).toBe("failed");
    expect(row?.retryCount).toBe(maxRetries);

    // A further sweep must NOT pick up the terminal row.
    let calledAgain = false;
    const after = await retryFailedGitHubSyncs(
      10,
      async () => {
        calledAgain = true;
        throw new Error("should not run");
      },
      maxRetries
    );
    expect(calledAgain).toBe(false);
    expect(after.attempted).toBe(0);
  });
});
