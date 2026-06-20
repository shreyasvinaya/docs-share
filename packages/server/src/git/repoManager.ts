import { $ } from "bun";
import { access, mkdir, rm, writeFile, chmod } from "fs/promises";
import { join } from "path";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";

/**
 * Build the post-receive hook script.
 *
 * SECURITY: never bake the plaintext HOOK_SECRET into the hook script — that
 * writes the secret to disk inside a world-readable repo. The hook instead
 * reads it from `$HOOK_SECRET` at run time, which the server-spawned
 * `git-receive-pack` process inherits (gitOps spawns with the server's
 * process.env), so the receiving hook still authenticates against
 * /internal/hooks/post-receive without the secret ever touching disk. The
 * file is additionally `chmod 0700` (owner-only) as defense in depth.
 */
function buildPostReceiveHook(): string {
  // SECURITY: the ref name (and other fields) are attacker-controlled — a client
  // can push a ref like `"; ...` — so we must NOT interpolate them straight into
  // the JSON body. Build the body with jq, which JSON-escapes every value via
  // --arg, so a malicious ref can never break out and produce malformed JSON (or
  // inject extra fields that confuse / DoS the indexer).
  return `#!/bin/bash
while read oldrev newrev refname; do
  payload=$(jq -nc \\
    --arg repoPath "$(pwd)" \\
    --arg ref "$refname" \\
    --arg oldRev "$oldrev" \\
    --arg newRev "$newrev" \\
    '{repoPath: $repoPath, ref: $ref, oldRev: $oldRev, newRev: $newRev}')
  curl -s -X POST "${config.HOOK_BASE_URL}/internal/hooks/post-receive" \\
    -H "Content-Type: application/json" \\
    -H "X-Hook-Secret: \${HOOK_SECRET}" \\
    -d "$payload"
done
`;
}

/**
 * Write the env-based post-receive hook into a bare repo and lock it down to
 * owner-only (0700). Idempotent: safe to call repeatedly on an existing repo.
 */
async function installPostReceiveHook(repoPath: string): Promise<void> {
  const hookPath = join(repoPath, "hooks", "post-receive");
  await writeFile(hookPath, buildPostReceiveHook(), "utf-8");
  await chmod(hookPath, 0o700);
}

/**
 * Create a bare git repository, enable http.receivepack,
 * and install the post-receive hook.
 */
export async function createBareRepo(repoPath: string): Promise<void> {
  await $`git init --bare ${repoPath}`;
  await $`git -C ${repoPath} config http.receivepack true`;
  await installPostReceiveHook(repoPath);
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

/**
 * Rewrite the post-receive hook for EVERY existing bare repo to the env-based
 * version (reads `$HOOK_SECRET` at run time, chmod 0700).
 *
 * The env-based hook is only installed for NEWLY created repos by
 * {@link createBareRepo}; repos created before that change still carry the old
 * world-readable hook with a baked-in plaintext `HOOK_SECRET`. This startup
 * repair rewrites them so no secret survives on disk.
 *
 * Idempotent (re-running just overwrites with identical content) and tolerant
 * of a missing repo directory (a row whose `diskPath` no longer exists on disk
 * is skipped rather than aborting the whole sweep).
 *
 * @returns Counts of repos repaired and skipped (missing on disk).
 */
export async function repairRepoHooks(): Promise<{
  repaired: number;
  skipped: number;
}> {
  const rows = await db
    .select({ diskPath: schema.repos.diskPath })
    .from(schema.repos)
    .all();

  let repaired = 0;
  let skipped = 0;
  for (const { diskPath } of rows) {
    try {
      // A bare repo must have a hooks/ directory; if the repo dir is gone,
      // access() throws and we skip it rather than failing the sweep.
      await access(join(diskPath, "hooks"));
    } catch {
      skipped += 1;
      continue;
    }
    try {
      await installPostReceiveHook(diskPath);
      repaired += 1;
    } catch (err) {
      // Never let one bad repo abort the rest of startup; log and continue.
      console.error(`Failed to repair post-receive hook for ${diskPath}:`, err);
      skipped += 1;
    }
  }

  return { repaired, skipped };
}
