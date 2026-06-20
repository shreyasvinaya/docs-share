import { describe, expect, test } from "bun:test";
import { GIT_TIMEOUT_MESSAGE, spawnWithTimeout } from "./gitOps.js";

describe("spawnWithTimeout", () => {
  test("returns output for a fast process within the timeout", async () => {
    const result = await spawnWithTimeout(["sh", "-c", "printf hello"], {
      timeoutMs: 5000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello");
  });

  test("kills a process that exceeds the timeout and reports it cleanly", async () => {
    const start = Date.now();
    // A process that would otherwise sleep far longer than the timeout.
    const result = await spawnWithTimeout(["sh", "-c", "sleep 30"], {
      timeoutMs: 200,
    });
    const elapsed = Date.now() - start;

    // It must have been killed well before the 30s sleep completed.
    expect(elapsed).toBeLessThan(5000);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(GIT_TIMEOUT_MESSAGE);
  });

  test("does not flag a process that finishes just under the timeout", async () => {
    const result = await spawnWithTimeout(["sh", "-c", "printf done"], {
      timeoutMs: 2000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(GIT_TIMEOUT_MESSAGE);
  });
});
