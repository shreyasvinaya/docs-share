import { $ } from "bun";
import { mkdir, rm, writeFile, chmod } from "fs/promises";
import { join } from "path";
import { config } from "../lib/config.js";

/**
 * Create a bare git repository, enable http.receivepack,
 * and install the post-receive hook.
 */
export async function createBareRepo(repoPath: string): Promise<void> {
  await $`git init --bare ${repoPath}`;
  await $`git -C ${repoPath} config http.receivepack true`;

  // SECURITY: never bake the plaintext HOOK_SECRET into the hook script — that
  // writes the secret to disk inside a world-readable repo. The hook instead
  // reads it from `$HOOK_SECRET` at run time, which the server-spawned
  // `git-receive-pack` process inherits (gitOps spawns with the server's
  // process.env), so the receiving hook still authenticates against
  // /internal/hooks/post-receive without the secret ever touching disk. The
  // file is additionally `chmod 0700` (owner-only) as defense in depth.
  const hookScript = `#!/bin/bash
while read oldrev newrev refname; do
  curl -s -X POST "${config.HOOK_BASE_URL}/internal/hooks/post-receive" \\
    -H "Content-Type: application/json" \\
    -H "X-Hook-Secret: \${HOOK_SECRET}" \\
    -d "{\\"repoPath\\": \\"$(pwd)\\", \\"ref\\": \\"$refname\\", \\"oldRev\\": \\"$oldrev\\", \\"newRev\\": \\"$newrev\\"}"
done
`;

  const hookPath = join(repoPath, "hooks", "post-receive");
  await writeFile(hookPath, hookScript, "utf-8");
  await chmod(hookPath, 0o700);
}

/**
 * Remove a bare repo directory from disk.
 */
export async function deleteRepo(repoPath: string): Promise<void> {
  await rm(repoPath, { recursive: true, force: true });
}

/**
 * Ensure the top-level repo directories exist under DATA_DIR.
 */
export async function ensureRepoDir(): Promise<void> {
  await mkdir(join(config.DATA_DIR, "repos", "users"), { recursive: true });
  await mkdir(join(config.DATA_DIR, "repos", "teams"), { recursive: true });
}
