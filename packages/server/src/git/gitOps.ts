import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { config } from "../lib/config.js";

/**
 * Result of running a git subprocess.
 */
export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Marker string surfaced in stderr/error when a git subprocess is killed for exceeding its timeout. */
export const GIT_TIMEOUT_MESSAGE = "git subprocess timed out";

/**
 * Run an arbitrary subprocess with a hard wall-clock timeout. When the deadline
 * is exceeded the process is killed (SIGKILL) and the result carries a non-zero
 * exit code plus a {@link GIT_TIMEOUT_MESSAGE} stderr, so callers fail cleanly
 * instead of hanging forever (and pinning a connection + worker).
 *
 * `timeoutMs <= 0` disables the timeout. Stdout/stderr are captured as text.
 */
export async function spawnWithTimeout(
  cmd: string[],
  options: {
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
  } = {}
): Promise<GitResult> {
  const timeoutMs = options.timeoutMs ?? config.GIT_PROCESS_TIMEOUT_MS;
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    env: options.env ?? process.env,
  });

  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          proc.kill("SIGKILL");
        }, timeoutMs)
      : null;

  try {
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    if (timedOut) {
      return {
        exitCode: proc.exitCode ?? 124,
        stdout,
        stderr: stderr.trim()
          ? `${stderr.trim()}\n${GIT_TIMEOUT_MESSAGE}`
          : GIT_TIMEOUT_MESSAGE,
      };
    }

    return { exitCode: proc.exitCode ?? 0, stdout, stderr };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run a git subprocess in the given working directory.
 * Returns captured stdout/stderr and the exit code.
 *
 * `GIT_LITERAL_PATHSPECS=1` is forced so that any user-controlled pathspec is
 * treated literally — pathspec "magic" like `:(top)` / `:!` is never
 * interpreted, removing a class of path-escape tricks. Callers that pass
 * user paths should still separate them after `--`.
 *
 * A hard timeout ({@link config.GIT_PROCESS_TIMEOUT_MS}) kills the subprocess if
 * it runs away.
 */
export async function runGit(args: string[]): Promise<GitResult> {
  return spawnWithTimeout(["git", ...args], {
    env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
  });
}

/**
 * A working clone of a bare repo, scoped to a temp directory.
 */
export interface RepoClone {
  /** Absolute path to the working clone. */
  dir: string;
  /** Run a git command inside the clone. */
  git(args: string[]): Promise<GitResult>;
}

/**
 * Clone a bare repo into a fresh temp directory, run the supplied callback,
 * and always clean up the temp directory afterwards.
 *
 * The callback receives a {@link RepoClone}; if the clone is empty (repo has
 * no commits) the clone is still initialised so files can be added.
 */
export async function withClonedRepo<T>(
  diskPath: string,
  author: { name: string; email: string },
  fn: (clone: RepoClone) => Promise<T>
): Promise<T> {
  const tmpDir = await mkdtemp(join(tmpdir(), "ds-git-"));
  const clonePath = join(tmpDir, "repo");

  try {
    const cloneResult = await runGit(["clone", diskPath, clonePath]);
    if (cloneResult.exitCode !== 0) {
      await runGit(["init", clonePath]);
      await runGit(["-C", clonePath, "remote", "add", "origin", diskPath]);
    }

    await runGit(["-C", clonePath, "config", "user.name", author.name]);
    await runGit(["-C", clonePath, "config", "user.email", author.email]);

    const clone: RepoClone = {
      dir: clonePath,
      git: (args) => runGit(["-C", clonePath, ...args]),
    };

    return await fn(clone);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Commit staged changes in a clone, push to origin, and return the new HEAD
 * sha. Returns `{ headSha: null }` when there was nothing to commit.
 */
export async function commitAndPush(
  clone: RepoClone,
  message: string
): Promise<{ headSha: string | null; error?: string }> {
  const commit = await clone.git(["commit", "-m", message]);
  if (commit.exitCode !== 0) {
    const output = `${commit.stdout}\n${commit.stderr}`;
    if (
      output.includes("nothing to commit") ||
      output.includes("no changes added to commit")
    ) {
      return { headSha: null };
    }
    return { headSha: null, error: output.trim() };
  }

  const push = await clone.git(["push", "origin", "HEAD"]);
  if (push.exitCode !== 0) {
    return { headSha: null, error: push.stderr.trim() };
  }

  const revParse = await clone.git(["rev-parse", "HEAD"]);
  return { headSha: revParse.stdout.trim() };
}
