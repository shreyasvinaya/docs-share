import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  spawn as nodeSpawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { config } from "../lib/config.js";

/**
 * Subset of the child's lifecycle events we listen to. The bundled
 * `node:child_process` typings don't surface the inherited `EventEmitter.on`
 * on `ChildProcess` under this toolchain, so we narrow to a precise typed
 * `.on` here rather than reaching for `any`.
 */
interface ChildLifecycle {
  on(event: "error", listener: (err: Error) => void): unknown;
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): unknown;
}

/** Typed view of a spawned child's lifecycle event emitter. */
function childEvents(child: ChildProcessWithoutNullStreams): ChildLifecycle {
  return child as unknown as ChildLifecycle;
}

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

/** Options shared by the process-group-aware spawn helpers. */
export interface SpawnOptions {
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** Optional bytes piped to the child's stdin. */
  stdin?: Uint8Array;
}

/**
 * Spawn a child in its OWN process group and run it under a hard wall-clock
 * timeout, killing the ENTIRE group on timeout.
 *
 * `detached: true` makes the child a process-group leader (Node calls
 * `setpgid`), so `git`'s own children — `git-remote-https`, the credential
 * helper, the `archive | tar` pipeline, etc. — share the child's pid as their
 * group id. On timeout we `process.kill(-pid, "SIGKILL")`, signalling the whole
 * group, so no grandchild is orphaned. (Killing only the direct pid, as the old
 * Bun.spawn path did, left those children running.)
 *
 * On a clean (non-timed-out) run, exit code and captured stdout/stderr are
 * returned exactly as before. `timeoutMs <= 0` disables the timeout. The child
 * is `unref`'d so a leaked group can never keep the event loop alive.
 */
function spawnGroup(
  cmd: string,
  args: string[],
  options: SpawnOptions = {}
): Promise<GitResult> {
  const timeoutMs = options.timeoutMs ?? config.GIT_PROCESS_TIMEOUT_MS;

  return new Promise<GitResult>((resolvePromise) => {
    const child = nodeSpawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: (options.env ?? process.env) as NodeJS.ProcessEnv,
      // Own process group: the child becomes group leader so its descendants
      // can be signalled as a unit via the negative pid.
      detached: true,
    });
    // Don't let a still-running group keep the process alive.
    child.unref();

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    if (options.stdin && child.stdin) {
      child.stdin.write(Buffer.from(options.stdin));
    }
    child.stdin?.end();

    let timedOut = false;
    let settled = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killGroup(child.pid);
          }, timeoutMs)
        : null;

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const rawStderr = Buffer.concat(stderrChunks).toString("utf8");
      if (timedOut) {
        resolvePromise({
          exitCode: exitCode || 124,
          stdout,
          stderr: rawStderr.trim()
            ? `${rawStderr.trim()}\n${GIT_TIMEOUT_MESSAGE}`
            : GIT_TIMEOUT_MESSAGE,
        });
        return;
      }
      resolvePromise({ exitCode, stdout, stderr: rawStderr });
    };

    const events = childEvents(child);
    events.on("error", () => {
      // spawn failure (e.g. binary missing): surface as a non-zero exit.
      finish(127);
    });
    events.on("close", (code, signal) => {
      // Killed children report a null code + signal; map to non-zero.
      finish(code ?? (signal ? 137 : 0));
    });
  });
}

/** SIGKILL an entire process group by its leader pid (best-effort). */
function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    // Negative pid => signal the whole group led by `pid`.
    process.kill(-pid, "SIGKILL");
  } catch {
    // Group already gone, or we lost the race; fall back to the direct pid.
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Nothing left to kill.
    }
  }
}

/** A streaming git subprocess and its binary stdout (web ReadableStream). */
export interface GitStream {
  /** Web ReadableStream of the child's stdout bytes (suitable for `new Response`). */
  stdout: ReadableStream<Uint8Array>;
  /** Resolves to the child's exit code (or a non-zero stand-in when killed). */
  exited: Promise<number>;
  /** Captured stderr text once the child has closed. */
  stderr: () => Promise<string>;
}

/**
 * Spawn a git subprocess in its OWN process group and STREAM its (binary)
 * stdout, killing the whole group on timeout. Used by the smart-HTTP endpoints
 * which must pipe the pack stream straight to the client rather than buffering
 * it. Like {@link spawnGroup}, `detached: true` makes the child a group leader
 * so `git-upload-pack`/`git-receive-pack` and any helper they fork are killed
 * together via the negative pid on timeout.
 */
export function spawnStreaming(
  cmd: string[],
  options: SpawnOptions = {}
): GitStream {
  const timeoutMs = options.timeoutMs ?? config.GIT_PROCESS_TIMEOUT_MS;
  const [bin, ...args] = cmd;
  const child = nodeSpawn(bin, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: (options.env ?? process.env) as NodeJS.ProcessEnv,
    detached: true,
  });
  child.unref();

  if (options.stdin && child.stdin) {
    child.stdin.write(Buffer.from(options.stdin));
  }
  child.stdin?.end();

  const stderrChunks: Buffer[] = [];
  child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const timer =
    timeoutMs > 0
      ? setTimeout(() => killGroup(child.pid), timeoutMs)
      : null;

  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout?.on("data", (chunk: Buffer) =>
        controller.enqueue(new Uint8Array(chunk))
      );
      child.stdout?.on("end", () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
      child.stdout?.on("error", (err) => {
        try {
          controller.error(err);
        } catch {
          // already errored/closed
        }
      });
    },
    cancel() {
      // Consumer aborted: tear down the whole group so nothing is orphaned.
      killGroup(child.pid);
    },
  });

  const exited = new Promise<number>((resolvePromise) => {
    const events = childEvents(child);
    events.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolvePromise(code ?? (signal ? 137 : 0));
    });
    events.on("error", () => {
      if (timer) clearTimeout(timer);
      resolvePromise(127);
    });
  });

  return {
    stdout,
    exited,
    stderr: async () => {
      await exited;
      return Buffer.concat(stderrChunks).toString("utf8");
    },
  };
}

/**
 * Run an arbitrary subprocess with a hard wall-clock timeout, in its own
 * process group so the WHOLE tree is killed on timeout (see {@link spawnGroup}).
 * When the deadline is exceeded the result carries a non-zero exit code plus a
 * {@link GIT_TIMEOUT_MESSAGE} stderr, so callers fail cleanly instead of hanging
 * forever (and pinning a connection + worker).
 *
 * `timeoutMs <= 0` disables the timeout. Stdout/stderr are captured as text.
 */
export async function spawnWithTimeout(
  cmd: string[],
  options: SpawnOptions = {}
): Promise<GitResult> {
  const [bin, ...args] = cmd;
  return spawnGroup(bin, args, options);
}

/**
 * Run a `/bin/sh -c <script>` pipeline (e.g. `git archive | tar -x`) under the
 * same process-group timeout. The shell is the group leader, so BOTH sides of
 * the pipe share its group and are killed together on timeout.
 */
export async function spawnShellWithTimeout(
  script: string,
  options: SpawnOptions = {}
): Promise<GitResult> {
  return spawnGroup("/bin/sh", ["-c", script], options);
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
