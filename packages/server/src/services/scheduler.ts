import { config } from "../lib/config.js";
import { sweepExpiredShares } from "./expiredShares.js";
import { retryFailedGitHubSyncs } from "./githubSyncRetry.js";

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  run: () => Promise<unknown>;
}

let timers: ReturnType<typeof setInterval>[] = [];

/**
 * Build the list of background jobs from configuration. A job with a
 * non-positive interval is omitted, which is how individual jobs are disabled.
 */
export function buildScheduledJobs(): ScheduledJob[] {
  const jobs: ScheduledJob[] = [];

  if (config.EXPIRED_SHARE_SWEEP_INTERVAL_MS > 0) {
    jobs.push({
      name: "expired-share-sweep",
      intervalMs: config.EXPIRED_SHARE_SWEEP_INTERVAL_MS,
      run: () => sweepExpiredShares(),
    });
  }

  if (config.GITHUB_SYNC_RETRY_INTERVAL_MS > 0) {
    jobs.push({
      name: "github-sync-retry",
      intervalMs: config.GITHUB_SYNC_RETRY_INTERVAL_MS,
      run: () => retryFailedGitHubSyncs(config.GITHUB_SYNC_RETRY_BATCH),
    });
  }

  return jobs;
}

/**
 * Run a single job, swallowing and logging any error so one failing pass never
 * tears down the interval.
 */
async function runJobSafely(job: ScheduledJob): Promise<void> {
  try {
    await job.run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[scheduler] job "${job.name}" failed: ${message}`);
  }
}

/**
 * Start the background scheduler. No-op when `SCHEDULER_ENABLED` is false (e.g.
 * during tests or CLI imports). Returns a stop function that clears all timers.
 *
 * @param jobs - Jobs to schedule; defaults to {@link buildScheduledJobs}.
 */
export function startScheduler(jobs: ScheduledJob[] = buildScheduledJobs()): () => void {
  if (!config.SCHEDULER_ENABLED) {
    return () => {};
  }

  for (const job of jobs) {
    const timer = setInterval(() => {
      void runJobSafely(job);
    }, job.intervalMs);
    // Do not keep the process alive solely for the scheduler.
    timer.unref?.();
    timers.push(timer);
  }

  return stopScheduler;
}

/**
 * Stop all running scheduler timers.
 */
export function stopScheduler(): void {
  for (const timer of timers) clearInterval(timer);
  timers = [];
}
