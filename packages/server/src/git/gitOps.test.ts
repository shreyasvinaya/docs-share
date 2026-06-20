import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  GIT_TIMEOUT_MESSAGE,
  runGit,
  spawnShellWithTimeout,
  spawnWithTimeout,
} from "./gitOps.js";

describe("spawnWithTimeout", () => {
  test("returns output for a fast process within the timeout", async () => {
    const result = await spawnWithTimeout(["sh", "-c", "printf hello"], {
      timeoutMs: 5000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello");
  });

  test("captures stdout and stderr and the real exit code on a clean run", async () => {
    const result = await spawnWithTimeout(
      ["sh", "-c", "printf out; printf err 1>&2; exit 3"],
      { timeoutMs: 5000 }
    );
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("out");
    expect(result.stderr).toContain("err");
    expect(result.stderr).not.toContain(GIT_TIMEOUT_MESSAGE);
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

  test("kills the WHOLE process group on timeout (no orphaned children)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ds-pgkill-"));
    const pidFile = join(dir, "child.pid");
    try {
      // Parent backgrounds a long-lived `sleep`, records its pid, then itself
      // blocks (`wait`). If only the parent's direct pid were killed, the
      // backgrounded sleep would survive; a process-group kill takes it too.
      const script = `sleep 60 & echo $! > ${pidFile}; wait`;
      const start = Date.now();
      const result = await spawnShellWithTimeout(script, { timeoutMs: 300 });
      expect(Date.now() - start).toBeLessThan(5000);
      expect(result.stderr).toContain(GIT_TIMEOUT_MESSAGE);

      // Give the kernel a beat to deliver the group SIGKILL.
      await new Promise((r) => setTimeout(r, 300));

      const childPid = Number((await readFile(pidFile, "utf8")).trim());
      expect(Number.isFinite(childPid)).toBe(true);

      // process.kill(pid, 0) throws ESRCH when the pid no longer exists.
      let alive = true;
      try {
        process.kill(childPid, 0);
      } catch {
        alive = false;
      }
      expect(alive).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe("spawnShellWithTimeout", () => {
  test("runs a shell pipeline and captures combined output", async () => {
    const result = await spawnShellWithTimeout(
      "printf 'a\\nb\\nc' | wc -l",
      { timeoutMs: 5000 }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("2");
  });
});

describe("runGit forces GIT_LITERAL_PATHSPECS (FIX 5)", () => {
  test("a `:(glob)**` pathspec is treated literally and matches nothing", async () => {
    const repo = await mkdtemp(join(tmpdir(), "ds-litpathspec-"));
    try {
      await runGit(["-C", repo, "init"]);
      await runGit(["-C", repo, "config", "user.email", "t@t.local"]);
      await runGit(["-C", repo, "config", "user.name", "t"]);
      // Commit two real files; a non-literal `:(glob)**` would match BOTH.
      await Bun.write(join(repo, "a.md"), "a");
      await Bun.write(join(repo, "b.md"), "b");
      await runGit(["-C", repo, "add", "-A"]);
      await runGit(["-C", repo, "commit", "-m", "init"]);

      // With GIT_LITERAL_PATHSPECS=1, `:(glob)**` is a literal filename that
      // does not exist, so ls-files returns nothing (it does NOT widen to all).
      const magic = await runGit([
        "-C",
        repo,
        "ls-files",
        "--",
        ":(glob)**",
      ]);
      expect(magic.exitCode).toBe(0);
      expect(magic.stdout.trim()).toBe("");

      // Sanity: a literal existing path DOES match, proving ls-files works.
      const literal = await runGit(["-C", repo, "ls-files", "--", "a.md"]);
      expect(literal.stdout.trim()).toBe("a.md");

      // And a literal `:notes.md`-style name (now an accepted normalized path)
      // matches only itself when it exists.
      await Bun.write(join(repo, ":notes.md"), "n");
      await runGit(["-C", repo, "add", "-A"]);
      await runGit(["-C", repo, "commit", "-m", "colon"]);
      const colon = await runGit(["-C", repo, "ls-files", "--", ":notes.md"]);
      expect(colon.stdout.trim()).toBe(":notes.md");
    } finally {
      await rm(repo, { recursive: true, force: true }).catch(() => {});
    }
  });
});
