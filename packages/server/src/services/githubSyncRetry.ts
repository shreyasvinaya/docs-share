import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { getUserGitHubToken } from "../routes/users.js";
import {
  redactSensitiveGitOutput,
  syncGitHubRepo,
  type GitHubSyncResult,
} from "./githubSync.js";

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
 * Only syncs with `status = "error"` AND `retry_count < maxRetries` are
 * eligible, so a permanently-broken sync cannot be retried forever. For each
 * eligible sync (up to `batch`) the matching repo is loaded, the configured
 * GitHub token is resolved, and the sync is retried. On success the row is
 * marked `success` and `retry_count` reset to 0. On failure `retry_count` is
 * incremented and:
 *
 *   - if it has now reached `maxRetries`, the row is moved to the terminal
 *     `failed` status so the retry sweep stops picking it up;
 *   - otherwise it stays in `error` for the next sweep.
 *
 * Any error text persisted on the row is passed through
 * {@link redactSensitiveGitOutput} first so embedded tokens never land in the
 * database. Rows whose repo no longer exists are skipped (their sync row is
 * removed by the repo cascade anyway).
 *
 * @param batch - Maximum number of failed syncs to retry in this pass.
 * @param runner - Sync implementation; defaults to {@link syncGitHubRepo}.
 *   Injectable so the retry orchestration can be tested without real git.
 * @param maxRetries - Attempt budget before a sync is marked terminally
 *   `failed`. Defaults to `config.GITHUB_SYNC_MAX_RETRIES`.
 */
export async function retryFailedGitHubSyncs(
  batch = 5,
  runner: SyncRunner = syncGitHubRepo,
  maxRetries = config.GITHUB_SYNC_MAX_RETRIES
): Promise<SyncRetryResult> {
  const failed = await db
    .select()
    .from(schema.githubSyncs)
    .where(
      and(
        eq(schema.githubSyncs.status, "error"),
        lt(schema.githubSyncs.retryCount, maxRetries)
      )
    )
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
          retryCount: 0,
          updatedAt: result.syncedAt,
        })
        .where(eq(schema.githubSyncs.id, sync.id))
        .run();
      succeeded += 1;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      // Redact any embedded credentials before the message is persisted.
      const message = redactSensitiveGitOutput(rawMessage);
      const nextRetryCount = sync.retryCount + 1;
      // Once the attempt budget is exhausted, move to the terminal `failed`
      // status so the sweep no longer selects this row.
      const exhausted = nextRetryCount >= maxRetries;
      await db
        .update(schema.githubSyncs)
        .set({
          status: exhausted ? "failed" : "error",
          error: message,
          retryCount: nextRetryCount,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.githubSyncs.id, sync.id))
        .run();
    }
  }

  return { attempted, succeeded, failed: attempted - succeeded };
}
