import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { getUserGitHubToken } from "../routes/users.js";
import { syncGitHubRepo, type GitHubSyncResult } from "./githubSync.js";

/**
 * Signature of the function used to perform a single GitHub sync. Mirrors
 * {@link syncGitHubRepo} so production code can pass it straight through while
 * tests inject a stub.
 */
export type SyncRunner = (
  repo: typeof schema.repos.$inferSelect,
  repoUrl: string,
  branch: string,
  sourcePath: string,
  token: string
) => Promise<GitHubSyncResult>;

export interface SyncRetryResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

/**
 * Re-attempt GitHub syncs that previously ended in the `error` state.
 *
 * For each failed sync (up to `batch`) the matching repo is loaded, the
 * configured GitHub token is resolved, and the sync is retried. On success the
 * row is marked `success`; on failure it stays `error` with the latest message.
 * Rows whose repo no longer exists are skipped (their sync row is removed by the
 * repo cascade anyway).
 *
 * @param batch - Maximum number of failed syncs to retry in this pass.
 * @param runner - Sync implementation; defaults to {@link syncGitHubRepo}.
 *   Injectable so the retry orchestration can be tested without real git.
 */
export async function retryFailedGitHubSyncs(
  batch = 5,
  runner: SyncRunner = syncGitHubRepo
): Promise<SyncRetryResult> {
  const failed = await db
    .select()
    .from(schema.githubSyncs)
    .where(eq(schema.githubSyncs.status, "error"))
    .limit(batch)
    .all();

  let succeeded = 0;
  let attempted = 0;

  for (const sync of failed) {
    const repo = await db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.id, sync.repoId))
      .get();
    if (!repo) continue;

    attempted += 1;

    await db
      .update(schema.githubSyncs)
      .set({ status: "syncing", updatedAt: new Date().toISOString() })
      .where(eq(schema.githubSyncs.id, sync.id))
      .run();

    const ownerUserId = repo.ownerUserId;
    const token = ownerUserId ? await getUserGitHubToken(ownerUserId) : "";

    try {
      const result = await runner(
        repo,
        sync.repoUrl,
        sync.branch,
        sync.sourcePath ?? "",
        token
      );
      await db
        .update(schema.githubSyncs)
        .set({
          lastCommitSha: result.commitSha,
          lastSyncedAt: result.syncedAt,
          status: "success",
          error: null,
          updatedAt: result.syncedAt,
        })
        .where(eq(schema.githubSyncs.id, sync.id))
        .run();
      succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(schema.githubSyncs)
        .set({
          status: "error",
          error: message,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.githubSyncs.id, sync.id))
        .run();
    }
  }

  return { attempted, succeeded, failed: attempted - succeeded };
}
