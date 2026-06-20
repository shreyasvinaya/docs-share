import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../lib/config.js";
import {
  buildScheduledJobs,
  startScheduler,
  stopScheduler,
  type ScheduledJob,
} from "./scheduler.js";

afterEach(() => {
  stopScheduler();
});

describe("buildScheduledJobs", () => {
  test("includes both jobs with positive intervals", () => {
    const jobs = buildScheduledJobs();
    const names = jobs.map((j) => j.name);
    if (config.EXPIRED_SHARE_SWEEP_INTERVAL_MS > 0) {
      expect(names).toContain("expired-share-sweep");
    }
    if (config.GITHUB_SYNC_RETRY_INTERVAL_MS > 0) {
      expect(names).toContain("github-sync-retry");
    }
    for (const job of jobs) {
      expect(job.intervalMs).toBeGreaterThan(0);
    }
  });
});

describe("startScheduler", () => {
  test("is a no-op under NODE_ENV=test unless forced", async () => {
    // bun test runs with NODE_ENV=test, so the unforced scheduler must not run.
    expect(process.env.NODE_ENV).toBe("test");

    let calls = 0;
    const jobs: ScheduledJob[] = [
      {
        name: "should-not-run",
        intervalMs: 5,
        run: async () => {
          calls += 1;
        },
      },
    ];

    const stop = startScheduler(jobs);
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    expect(calls).toBe(0);
  });

  test("invokes each job on its interval and stop clears the timers", async () => {
    let calls = 0;
    const jobs: ScheduledJob[] = [
      {
        name: "test-job",
        intervalMs: 5,
        run: async () => {
          calls += 1;
        },
      },
    ];

    const stop = startScheduler(jobs, true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    const afterStop = calls;
    expect(afterStop).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 20));
    // No further runs after stopping.
    expect(calls).toBe(afterStop);
  });

  test("isolates job failures so one throwing job does not stop the scheduler", async () => {
    let healthyCalls = 0;
    const jobs: ScheduledJob[] = [
      {
        name: "throwing",
        intervalMs: 5,
        run: async () => {
          throw new Error("boom");
        },
      },
      {
        name: "healthy",
        intervalMs: 5,
        run: async () => {
          healthyCalls += 1;
        },
      },
    ];

    startScheduler(jobs, true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    stopScheduler();
    expect(healthyCalls).toBeGreaterThan(0);
  });

  test("skips a tick while the previous run of the same job is still in flight", async () => {
    let started = 0;
    const release = { fn: undefined as (() => void) | undefined };
    const jobs: ScheduledJob[] = [
      {
        name: "slow-job",
        // Fire frequently so several ticks elapse during one slow run.
        intervalMs: 5,
        run: async () => {
          started += 1;
          // Block this run until we explicitly release it. Subsequent ticks
          // must be skipped while this run is outstanding.
          await new Promise<void>((resolve) => {
            release.fn = resolve;
          });
        },
      },
    ];

    startScheduler(jobs, true);
    // Let many ticks fire while the first (and only) run is blocked.
    await new Promise((resolve) => setTimeout(resolve, 40));
    // Despite many ticks, the in-flight guard allowed only one concurrent run.
    expect(started).toBe(1);

    // Release the run and confirm a later tick can start a fresh run.
    release.fn?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    stopScheduler();
    expect(started).toBeGreaterThan(1);
  });
});
