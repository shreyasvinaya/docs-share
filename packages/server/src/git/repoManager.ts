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

  const hookScript = `#!/bin/bash
while read oldrev newrev refname; do
  curl -s -X POST "${config.HOOK_BASE_URL}/internal/hooks/post-receive" \\
    -H "Content-Type: application/json" \\
    -H "X-Hook-Secret: ${config.HOOK_SECRET}" \\
    -d "{\\"repoPath\\": \\"$(pwd)\\", \\"ref\\": \\"$refname\\", \\"oldRev\\": \\"$oldrev\\", \\"newRev\\": \\"$newrev\\"}"
done
`;

  const hookPath = join(repoPath, "hooks", "post-receive");
  await writeFile(hookPath, hookScript, "utf-8");
  await chmod(hookPath, 0o755);
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
