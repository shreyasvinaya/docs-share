import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Result of running a git subprocess.
 */
export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a git subprocess in the given working directory.
 * Returns captured stdout/stderr and the exit code.
 *
 * `GIT_LITERAL_PATHSPECS=1` is forced so that any user-controlled pathspec is
 * treated literally — pathspec "magic" like `:(top)` / `:!` is never
 * interpreted, removing a class of path-escape tricks. Callers that pass
 * user paths should still separate them after `--`.
 */
export async function runGit(args: string[]): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return { exitCode: proc.exitCode ?? 0, stdout, stderr };
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
