import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { redactInternalPaths } from "../lib/security.js";
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
 * {@link redactSensitiveGitOutput} AND {@link redactInternalPaths} first so
 * neither embedded tokens nor server-internal filesystem paths land in the
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
  maxRetries = config.GITHUB_SYNC_MAX_RETRIES,
  tokenResolver: (userId: string) => Promise<string> = getUserGitHubToken
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

    // Use the credential of the user who CONFIGURED the sync — NEVER the repo
    // owner's. Otherwise a non-owner holding a whole-repo write share could
    // configure a sync pointing at the owner's private GitHub repo and have the
    // background retry clone it with the owner's token (cross-tenant
    // exfiltration). Fail closed when the configurer is unknown (legacy rows) or
    // has no GitHub credential, marking the sync terminally failed.
    let token = "";
    if (sync.configuredByUserId) {
      try {
        token = await tokenResolver(sync.configuredByUserId);
      } catch {
        token = "";
      }
    }
    if (!token) {
      await db
        .update(schema.githubSyncs)
        .set({
          status: "failed",
          error:
            "Sync cannot be retried: the user who configured it has no GitHub credential.",
          retryCount: maxRetries,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.githubSyncs.id, sync.id))
        .run();
      continue;
    }

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
      // Redact embedded credentials AND server-internal filesystem paths
      // (temp clone dirs, repo.diskPath) before the message is persisted and
      // later surfaced to the client.
      const message = redactInternalPaths(redactSensitiveGitOutput(rawMessage));
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
