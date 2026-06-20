import { rm, mkdir } from "fs/promises";
import { join } from "path";
import { eq } from "drizzle-orm";
import { config } from "../lib/config.js";
import { db, schema } from "../db/index.js";
import { generateId } from "../lib/crypto.js";
import { spawnShellWithTimeout, spawnWithTimeout } from "../git/gitOps.js";

/** Quote a string for safe interpolation into a single-quoted `/bin/sh` word. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Extract files from a bare repo using `git archive` piped to `tar`.
 * The result is written to `${DATA_DIR}/worktrees/${repoId}/`.
 * Any existing directory is removed first.
 *
 * The `archive | tar` pipeline runs via {@link spawnShellWithTimeout}: a single
 * shell is the process-group leader, so BOTH `git archive` and `tar` share its
 * group and are killed together if the pipeline runs away (neither side can
 * orphan).
 */
export async function extractRepoFiles(
  repoId: string,
  repoPath: string,
  ref: string
): Promise<void> {
  const worktreePath = join(config.DATA_DIR, "worktrees", repoId);

  await rm(worktreePath, { recursive: true, force: true });
  await mkdir(worktreePath, { recursive: true });

  const script = `git -C ${shellQuote(repoPath)} archive ${shellQuote(
    ref
  )} | tar -x -C ${shellQuote(worktreePath)}`;
  const result = await spawnShellWithTimeout(script, {
    env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git archive | tar failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`
    );
  }
}

/**
 * Index a bare repo's file tree into the database.
 * Uses `git ls-tree -r --long <ref>` to enumerate every blob,
 * then replaces the existing file records in a single transaction.
 *
 * Runs via the shared process-group timeout helper so a runaway `git ls-tree`
 * (and any helper it spawns) is killed as a unit.
 */
export async function indexRepoFiles(
  repoId: string,
  repoPath: string,
  ref: string
): Promise<void> {
  const result = await spawnWithTimeout(
    ["git", "-C", repoPath, "ls-tree", "-r", "--long", ref],
    { env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" } }
  );

  if (result.exitCode !== 0) {
    throw new Error(`git ls-tree failed: ${result.stderr}`);
  }

  const output = result.stdout;
  const lines = output.trim().split("\n").filter(Boolean);

  const fileRecords = lines.map((line) => {
    // Format: <mode> <type> <sha>    <size>\t<path>
    const tabIndex = line.indexOf("\t");
    const meta = line.slice(0, tabIndex).split(/\s+/);
    const path = line.slice(tabIndex + 1);

    const blobSha = meta[2];
    const sizeBytes = parseInt(meta[3], 10);

    return {
      id: generateId(),
      repoId,
      path,
      blobSha,
      sizeBytes,
      mimeType: guessMimeType(path),
      updatedAt: new Date().toISOString(),
    };
  });

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.files)
      .where(eq(schema.files.repoId, repoId))
      .run();

    for (const record of fileRecords) {
      await tx.insert(schema.files).values(record).run();
    }
  });
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

/**
 * Return a MIME type based on the file extension.
 * Falls back to application/octet-stream for unknown extensions.
 */
export function guessMimeType(path: string): string {
  const dotIndex = path.lastIndexOf(".");
  if (dotIndex === -1) return "application/octet-stream";

  const ext = path.slice(dotIndex).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}
