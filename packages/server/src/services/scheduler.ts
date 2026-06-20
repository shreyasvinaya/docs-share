import { config } from "../lib/config.js";
import { sweepExpiredShares } from "./expiredShares.js";
import { retryFailedGitHubSyncs } from "./githubSyncRetry.js";
import { cleanupWebhookDeliveries } from "./webhookCleanup.js";
import { cleanupAuditLog, cleanupViewEvents } from "./analyticsCleanup.js";

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

  if (config.WEBHOOK_CLEANUP_INTERVAL_MS > 0) {
    jobs.push({
      name: "webhook-delivery-cleanup",
      intervalMs: config.WEBHOOK_CLEANUP_INTERVAL_MS,
      run: () =>
        cleanupWebhookDeliveries({
          retentionDays: config.WEBHOOK_DELIVERY_RETENTION_DAYS,
          maxPerWebhook: config.WEBHOOK_DELIVERY_MAX_PER_HOOK,
        }),
    });
  }

  if (config.VIEW_EVENTS_CLEANUP_INTERVAL_MS > 0) {
    jobs.push({
      name: "view-events-cleanup",
      intervalMs: config.VIEW_EVENTS_CLEANUP_INTERVAL_MS,
      run: () =>
        cleanupViewEvents({
          retentionDays: config.VIEW_EVENTS_RETENTION_DAYS,
        }),
    });
  }

  if (config.AUDIT_LOG_CLEANUP_INTERVAL_MS > 0) {
    jobs.push({
      name: "audit-log-cleanup",
      intervalMs: config.AUDIT_LOG_CLEANUP_INTERVAL_MS,
      run: () =>
        cleanupAuditLog({
          retentionDays: config.AUDIT_LOG_RETENTION_DAYS,
        }),
    });
  }

  return jobs;
}

// Names of jobs whose previous run has not yet finished. Used to skip a tick
// rather than launching a second concurrent run of the same job.
const inFlight = new Set<string>();

/**
 * Run a single job, swallowing and logging any error so one failing pass never
 * tears down the interval. A per-job in-flight guard prevents a job from
 * starting again while its previous run is still executing: if a tick fires
 * while the job is still in flight, that tick is skipped.
 */
async function runJobSafely(job: ScheduledJob): Promise<void> {
  if (inFlight.has(job.name)) {
    // Previous run still executing — skip this tick to avoid overlap.
    return;
  }
  inFlight.add(job.name);
  try {
    await job.run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[scheduler] job "${job.name}" failed: ${message}`);
  } finally {
    inFlight.delete(job.name);
  }
}

/**
 * Start the background scheduler. Returns a stop function that clears all
 * timers.
 *
 * No-op (returning an inert stop function) when any of the following hold, so
 * the scheduler never runs by accident in tests or when explicitly disabled:
 *
 *   - `process.env.NODE_ENV === "test"`;
 *   - the `SCHEDULER_ENABLED` config is false (env `SCHEDULER_ENABLED=false`).
 *
 * @param jobs - Jobs to schedule; defaults to {@link buildScheduledJobs}.
 * @param force - Bypass the test/disabled guards. Intended for unit tests that
 *   need to exercise the scheduling logic directly; production callers leave
 *   this false.
 */
export function startScheduler(
  jobs: ScheduledJob[] = buildScheduledJobs(),
  force = false
): () => void {
  if (!force && (process.env.NODE_ENV === "test" || !config.SCHEDULER_ENABLED)) {
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
  inFlight.clear();
}
