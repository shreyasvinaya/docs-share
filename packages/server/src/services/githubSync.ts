import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import {
  extractRepoFiles,
  indexRepoFiles,
} from "./fileExtractor.js";

export interface GitHubSyncResult {
  commitSha: string;
  syncedAt: string;
}

export function normalizeGitHubRepoUrl(repoUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    return null;
  }

  const parts = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length !== 2) return null;

  const [owner, repo] = parts;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner)) return null;
  if (!/^[A-Za-z0-9_.-]+(?:\.git)?$/.test(repo)) return null;

  return `https://github.com/${owner}/${repo.endsWith(".git") ? repo : `${repo}.git`}`;
}

export function normalizeGitBranch(branch: string | null | undefined): string | null {
  const value = branch?.trim() || "main";
  if (
    value.includes("\0") ||
    value.startsWith("-") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("..") ||
    value.includes(" ") ||
    !/^[A-Za-z0-9._/-]+$/.test(value)
  ) {
    return null;
  }
  return value;
}

export async function syncGitHubRepo(
  repo: typeof schema.repos.$inferSelect,
  repoUrl: string,
  branch: string
): Promise<GitHubSyncResult> {
  const normalizedUrl = normalizeGitHubRepoUrl(repoUrl);
  const normalizedBranch = normalizeGitBranch(branch);

  if (!normalizedUrl) {
    throw new Error("Only public https://github.com/<owner>/<repo> URLs are supported");
  }
  if (!normalizedBranch) {
    throw new Error("Invalid GitHub branch name");
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "ds-github-sync-"));
  const clonePath = join(tmpDir, "source");

  try {
    await runGit([
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--branch",
      normalizedBranch,
      normalizedUrl,
      clonePath,
    ]);

    const commitSha = await gitOutput(["-C", clonePath, "rev-parse", "HEAD"]);

    await runGit([
      "-C",
      clonePath,
      "push",
      repo.diskPath,
      "HEAD:refs/heads/main",
      "--force",
    ]);

    await extractRepoFiles(repo.id, repo.diskPath, commitSha);
    await indexRepoFiles(repo.id, repo.diskPath, commitSha);

    const syncedAt = new Date().toISOString();
    await db
      .update(schema.repos)
      .set({
        headSha: commitSha,
        lastPushAt: syncedAt,
      })
      .where(eq(schema.repos.id, repo.id))
      .run();

    return { commitSha, syncedAt };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runGit(args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
  }
}

async function gitOutput(args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return stdout.trim();
}
