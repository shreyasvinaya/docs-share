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

    const stop = startScheduler(jobs);
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

    startScheduler(jobs);
    await new Promise((resolve) => setTimeout(resolve, 30));
    stopScheduler();
    expect(healthyCalls).toBeGreaterThan(0);
  });
});
