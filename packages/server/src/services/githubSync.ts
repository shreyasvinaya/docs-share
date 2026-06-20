import { cp, lstat, mkdtemp, readdir, realpath, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join, relative, resolve, sep } from "path";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { redactInternalPaths } from "../lib/security.js";
import { spawnWithTimeout } from "../git/gitOps.js";
import {
  extractRepoFiles,
  indexRepoFiles,
} from "./fileExtractor.js";

export interface GitHubSyncResult {
  commitSha: string;
  syncedAt: string;
}

export interface GitHubTreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

export interface GitHubTreeNode {
  path: string;
  name: string;
  type: "file" | "directory";
  size: number | null;
}

export interface GitHubRepositoryOption {
  fullName: string;
  repoUrl: string;
  defaultBranch: string;
  private: boolean;
  pushedAt: string | null;
  updatedAt: string | null;
  ownerLogin: string;
}

export interface GitHubOrganizationOption {
  login: string;
  description: string | null;
  avatarUrl: string | null;
}

export type GitHubCredentialType = "pat" | "github_app";

export interface GitHubCredential {
  token: string;
  type: GitHubCredentialType;
}

const RECOMMENDED_BRANCH_ORDER = [
  "main",
  "master",
  "staging",
  "gh-pages",
  "develop",
  "dev",
  "production",
  "prod",
  "release",
];
const MAX_GITHUB_PAGES = 100;

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

export function redactSensitiveGitOutput(output: string): string {
  return output
    .replace(/x-access-token:[^@\s]+@/g, "x-access-token:[redacted]@")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[redacted]");
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

export function normalizeGitHubImportPath(path: string | null | undefined): string | null {
  const rawValue = path?.trim() ?? "";
  if (rawValue.startsWith("/")) return null;
  const value = rawValue.replace(/\/+$/g, "");
  if (!value) return "";
  if (
    value.includes("\0") ||
    value.includes("..") ||
    value.split("/").includes(".git") ||
    !/^[A-Za-z0-9._@+/-]+$/.test(value)
  ) {
    return null;
  }
  return value;
}

export function orderGitHubBranches(branches: string[]): string[] {
  const normalized = [...new Set(branches.map((branch) => branch.trim()).filter(Boolean))];
  const branchRank = new Map(
    RECOMMENDED_BRANCH_ORDER.map((branch, index) => [branch, index])
  );

  return normalized.sort((a, b) => {
    const aRank = branchRank.get(a);
    const bRank = branchRank.get(b);
    if (aRank !== undefined || bRank !== undefined) {
      return (aRank ?? Number.MAX_SAFE_INTEGER) - (bRank ?? Number.MAX_SAFE_INTEGER);
    }
    return a.localeCompare(b);
  });
}

export function filterGitHubTree(
  tree: GitHubTreeEntry[],
  parentPath: string | null | undefined
): GitHubTreeNode[] {
  const parent = normalizeGitHubImportPath(parentPath);
  if (parent === null) return [];
  const prefix = parent ? `${parent}/` : "";
  const nodes = new Map<string, GitHubTreeNode>();

  for (const item of tree) {
    if (prefix && !item.path.startsWith(prefix)) continue;
    const relative = prefix ? item.path.slice(prefix.length) : item.path;
    if (!relative) continue;
    const [name] = relative.split("/");
    const childPath = prefix ? `${prefix}${name}` : name;
    const isNested = relative.includes("/");
    const type = isNested || item.type === "tree" ? "directory" : "file";

    if (!nodes.has(childPath)) {
      nodes.set(childPath, {
        path: childPath,
        name,
        type,
        size: type === "file" ? item.size ?? null : null,
      });
    }
  }

  return [...nodes.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function listGitHubAccessibleRepos(
  credential: GitHubCredential | string,
  ownerLogin = ""
): Promise<GitHubRepositoryOption[]> {
  const { token, type } = normalizeCredential(credential);
  if (!token.trim()) return [];
  const normalizedOwnerLogin = normalizeGitHubOwnerLogin(ownerLogin);
  if (normalizedOwnerLogin === null) {
    throw new Error("Invalid GitHub organization name");
  }

  if (type === "github_app") {
    return listGitHubInstallationRepos(token, normalizedOwnerLogin);
  }

  const repos: GitHubRepositoryOption[] = [];
  for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
    const url = new URL("https://api.github.com/user/repos");
    url.searchParams.set("affiliation", "owner,collaborator,organization_member");
    url.searchParams.set("visibility", "all");
    url.searchParams.set("sort", "updated");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const res = await fetch(url, { headers: githubApiHeaders(token) });
    if (!res.ok) {
      throw new Error(`GitHub repository lookup failed: ${res.status} ${res.statusText}`);
    }

    const pageRepos = (await res.json()) as {
      full_name?: string;
      clone_url?: string;
      default_branch?: string;
      private?: boolean;
      pushed_at?: string | null;
      updated_at?: string | null;
      owner?: { login?: string };
    }[];
    for (const repo of pageRepos) {
      if (!repo.full_name || !repo.clone_url || !repo.default_branch) continue;
      const normalizedUrl = normalizeGitHubRepoUrl(repo.clone_url);
      const repoOwnerLogin = repo.owner?.login ?? repo.full_name.split("/")[0] ?? "";
      if (!normalizedUrl) continue;
      if (
        normalizedOwnerLogin &&
        repoOwnerLogin.toLowerCase() !== normalizedOwnerLogin.toLowerCase()
      ) {
        continue;
      }
      repos.push({
        fullName: repo.full_name,
        repoUrl: normalizedUrl,
        defaultBranch: repo.default_branch,
        private: Boolean(repo.private),
        pushedAt: repo.pushed_at ?? null,
        updatedAt: repo.updated_at ?? null,
        ownerLogin: repoOwnerLogin,
      });
    }

    if (pageRepos.length < 100) break;
  }

  return repos;
}

export async function listGitHubOrganizations(
  credential: GitHubCredential | string
): Promise<GitHubOrganizationOption[]> {
  const { token, type } = normalizeCredential(credential);
  if (!token.trim()) return [];

  if (type === "github_app") {
    const accessibleRepos = await listGitHubAccessibleRepos({ token, type });
    return organizationsFromRepos(accessibleRepos);
  }

  const organizations = new Map<string, GitHubOrganizationOption>();
  try {
    for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
      const url = new URL("https://api.github.com/user/orgs");
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));

      const res = await fetch(url, { headers: githubApiHeaders(token) });
      if (!res.ok) break;

      const pageOrganizations = (await res.json()) as {
        login?: string;
        description?: string | null;
        avatar_url?: string | null;
      }[];
      for (const organization of pageOrganizations) {
        if (!organization.login) continue;
        organizations.set(organization.login.toLowerCase(), {
          login: organization.login,
          description: organization.description ?? null,
          avatarUrl: organization.avatar_url ?? null,
        });
      }

      if (pageOrganizations.length < 100) break;
    }
  } catch {
    // Fall back to repository owners below; /user/repos is the source of truth
    // for what the connected token can actually import.
  }

  const accessibleRepos = await listGitHubAccessibleRepos({ token, type });
  for (const organization of organizationsFromRepos(accessibleRepos)) {
    const key = organization.login.toLowerCase();
    if (!key || organizations.has(key)) continue;
    organizations.set(key, organization);
  }

  return [...organizations.values()].sort((a, b) => a.login.localeCompare(b.login));
}

export async function listGitHubBranches(params: {
  repoUrl: string;
  token?: string;
}): Promise<string[]> {
  const normalizedUrl = normalizeGitHubRepoUrl(params.repoUrl);
  if (!normalizedUrl) throw new Error("Only https://github.com/<owner>/<repo> URLs are supported");

  const { owner, repo } = parseGitHubRepo(normalizedUrl);
  const branches: string[] = [];
  for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/branches`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const res = await fetch(url, { headers: githubApiHeaders(params.token) });
    if (!res.ok) {
      throw new Error(`GitHub branch lookup failed: ${res.status} ${res.statusText}`);
    }

    const pageBranches = (await res.json()) as { name?: string }[];
    branches.push(
      ...pageBranches
        .map((branch) => branch.name ?? "")
        .filter((name) => normalizeGitBranch(name) !== null)
    );

    if (pageBranches.length < 100) break;
  }

  return orderGitHubBranches(branches);
}

export async function listGitHubRemoteTree(params: {
  repoUrl: string;
  branch: string;
  path?: string | null;
  token?: string;
}): Promise<GitHubTreeNode[]> {
  const normalizedUrl = normalizeGitHubRepoUrl(params.repoUrl);
  const normalizedBranch = normalizeGitBranch(params.branch);
  const normalizedPath = normalizeGitHubImportPath(params.path);

  if (!normalizedUrl) throw new Error("Only https://github.com/<owner>/<repo> URLs are supported");
  if (!normalizedBranch) throw new Error("Invalid GitHub branch name");
  if (normalizedPath === null) throw new Error("Invalid GitHub import path");

  const { owner, repo } = parseGitHubRepo(normalizedUrl);
  const url = new URL(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(normalizedBranch)}`
  );
  url.searchParams.set("recursive", "1");

  const res = await fetch(url, { headers: githubApiHeaders(params.token) });
  if (!res.ok) {
    throw new Error(`GitHub tree lookup failed: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as {
    tree?: { path: string; type: string; size?: number }[];
  };
  return filterGitHubTree(
    (body.tree ?? [])
      .filter((item) => item.type === "blob" || item.type === "tree")
      .map((item) => ({
        path: item.path,
        type: item.type as "blob" | "tree",
        size: item.size,
      })),
    normalizedPath
  );
}

/**
 * Reject an import whose GitHub-reported repository size exceeds
 * `maxImportKb` BEFORE any clone runs, so a malicious huge repo cannot fill
 * DATA_DIR. The GitHub `size` field is in KiB. A lookup failure (network error,
 * missing/permission-denied repo) is non-fatal here: the clone itself will then
 * fail-closed with its own error, so we never block a legitimate import just
 * because the lightweight metadata call hiccupped.
 *
 * @param maxImportKb - Reject when reported size strictly exceeds this. Pass
 *   <= 0 to disable the precheck.
 */
export async function assertRepoSizeWithinLimit(params: {
  repoUrl: string;
  token?: string;
  maxImportKb?: number;
}): Promise<void> {
  const maxImportKb = params.maxImportKb ?? config.GITHUB_MAX_IMPORT_KB;
  if (maxImportKb <= 0) return;

  const normalizedUrl = normalizeGitHubRepoUrl(params.repoUrl);
  if (!normalizedUrl) {
    throw new Error("Only https://github.com/<owner>/<repo> URLs are supported");
  }
  const { owner, repo } = parseGitHubRepo(normalizedUrl);

  let sizeKb: number | null = null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: githubApiHeaders(params.token) }
    );
    if (res.ok) {
      const body = (await res.json()) as { size?: number };
      if (typeof body.size === "number" && Number.isFinite(body.size)) {
        sizeKb = body.size;
      }
    }
  } catch {
    // Metadata lookup failed; defer to the clone's own fail-closed behaviour.
    return;
  }

  if (sizeKb !== null && sizeKb > maxImportKb) {
    throw new Error(
      `GitHub repository is too large to import (${sizeKb} KiB exceeds the ${maxImportKb} KiB limit)`
    );
  }
}

/**
 * Reject the import if any blob in the SELECTED tree exceeds
 * `GITHUB_MAX_BLOB_BYTES` (and/or the selected tree's total exceeds the import
 * cap), BEFORE any blob is checked out.
 *
 * A `--filter=blob:limit` partial clone does not actually enforce a per-blob
 * cap on imported content: omitted blobs are transparently re-fetched on demand
 * the moment they are needed (e.g. at checkout). The cap is therefore enforced
 * here by enumerating the tree with sizes via `git ls-tree -r -l <ref>`, which
 * reports each blob's byte size without materializing it.
 *
 * @param clonePath - The `--no-checkout` clone root.
 * @param sourcePath - The normalized selected import path. Empty string means
 *   the whole repository (root import).
 */
export async function assertImportBlobsWithinLimit(
  clonePath: string,
  sourcePath: string
): Promise<void> {
  const maxBlobBytes = config.GITHUB_MAX_BLOB_BYTES;

  // `git ls-tree -r -l HEAD -- <path>` lists every blob reachable under <path>
  // (recursively) with its size, e.g.:
  //   100644 blob <sha> <size>\t<path>
  // The size column is "-" for non-blob entries (submodules); those carry no
  // content to import, so they are ignored.
  const args = ["-C", clonePath, "ls-tree", "-r", "-l", "HEAD"];
  if (sourcePath) args.push("--", sourcePath);
  const listing = await gitOutput(args);

  if (!listing) return; // Empty tree / path with no blobs.

  let total = 0;
  for (const line of listing.split("\n")) {
    if (!line.trim()) continue;
    // Split the metadata (mode type sha size) from the path on the literal TAB.
    const [meta] = line.split("\t");
    const fields = meta.trim().split(/\s+/);
    // fields = [mode, type, sha, size]; size is "-" for non-blob entries.
    const sizeField = fields[3];
    if (!sizeField || sizeField === "-") continue;
    const size = Number(sizeField);
    if (!Number.isFinite(size)) continue;
    if (size > maxBlobBytes) {
      throw new Error(
        `GitHub import contains a file larger than the ${maxBlobBytes}-byte ` +
          `per-file limit and cannot be imported`
      );
    }
    total += size;
  }

  const maxTotalBytes = config.GITHUB_MAX_IMPORT_KB * 1024;
  if (maxTotalBytes > 0 && total > maxTotalBytes) {
    throw new Error(
      `GitHub import is too large (${total} bytes exceeds the ` +
        `${maxTotalBytes}-byte import limit)`
    );
  }
}

/**
 * Check out only the validated import path from a `--no-checkout` clone into the
 * work tree. For a root import (empty `sourcePath`) the entire tree is checked
 * out. Must run AFTER {@link assertImportBlobsWithinLimit} so no oversized blob
 * is ever materialized.
 */
async function checkoutImportPath(
  clonePath: string,
  sourcePath: string
): Promise<void> {
  const args = ["-C", clonePath, "checkout", "HEAD", "--"];
  args.push(sourcePath ? sourcePath : ".");
  await runGit(args);
}

// Per-repo in-process async lock. Concurrent syncs of the SAME repo race on the
// force-push + extract + re-index sequence below, which can corrupt the bare repo
// or leave the index inconsistent. We serialize them by chaining onto a tail
// promise keyed by repoId; different repos still sync in parallel.
const repoSyncLocks = new Map<string, Promise<unknown>>();

function withRepoSyncLock<T>(repoId: string, fn: () => Promise<T>): Promise<T> {
  const previous = repoSyncLocks.get(repoId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // Keep the chain alive but drop the entry once this is the last waiter so the
  // map does not grow unbounded.
  repoSyncLocks.set(repoId, next);
  void next.catch(() => {}).finally(() => {
    if (repoSyncLocks.get(repoId) === next) repoSyncLocks.delete(repoId);
  });
  return next;
}

export function syncGitHubRepo(
  repo: typeof schema.repos.$inferSelect,
  repoUrl: string,
  branch: string,
  sourcePath = "",
  token = ""
): Promise<GitHubSyncResult> {
  return withRepoSyncLock(repo.id, () =>
    syncGitHubRepoUnlocked(repo, repoUrl, branch, sourcePath, token)
  );
}

async function syncGitHubRepoUnlocked(
  repo: typeof schema.repos.$inferSelect,
  repoUrl: string,
  branch: string,
  sourcePath = "",
  token = ""
): Promise<GitHubSyncResult> {
  const normalizedUrl = normalizeGitHubRepoUrl(repoUrl);
  const normalizedBranch = normalizeGitBranch(branch);
  const normalizedSourcePath = normalizeGitHubImportPath(sourcePath);

  if (!normalizedUrl) {
    throw new Error("Only https://github.com/<owner>/<repo> URLs are supported");
  }
  if (!normalizedBranch) {
    throw new Error("Invalid GitHub branch name");
  }
  if (normalizedSourcePath === null) {
    throw new Error("Invalid GitHub import path");
  }

  // Bound disk usage BEFORE cloning: reject an oversized repo by its
  // GitHub-reported size so a malicious huge repo cannot fill DATA_DIR.
  await assertRepoSizeWithinLimit({ repoUrl: normalizedUrl, token });

  const tmpDir = await mkdtemp(join(tmpdir(), "ds-github-sync-"));
  const clonePath = join(tmpDir, "source");
  const importPath = join(tmpDir, "import");
  const gitEnv = token ? await createGitAuthEnv(tmpDir, token) : undefined;

  try {
    await runGit([
      "clone",
      "--depth",
      "1",
      "--single-branch",
      // Defer the checkout so we can size-check the SELECTED tree BEFORE any
      // blob is materialized. A `--filter=blob:limit` partial clone alone does
      // NOT enforce the cap: omitted blobs are silently re-fetched on demand at
      // checkout, so the per-blob limit is only enforced by the explicit
      // ls-tree preflight below.
      "--no-checkout",
      `--filter=blob:limit=${config.GITHUB_MAX_BLOB_BYTES}`,
      "--branch",
      normalizedBranch,
      normalizedUrl,
      clonePath,
    ], gitEnv);

    // Enforce the per-blob size cap on the selected import path (or the whole
    // tree for a root import) BEFORE checking anything out. Rejects the import
    // outright if any blob is over the limit, so an oversized blob is never
    // materialized, committed, or pushed.
    await assertImportBlobsWithinLimit(clonePath, normalizedSourcePath);

    // Now that the selected tree is proven within budget, materialize only the
    // validated path (or the whole tree for a root import) into the work tree.
    await checkoutImportPath(clonePath, normalizedSourcePath);

    // Always route through the symlink-stripping copy — for BOTH a sub-path and a
    // whole-repo (root, empty sourcePath) import. This rebuilds a clean import
    // tree via copyWithoutSymlinks, which rejects/skips every symlink entry, so a
    // malicious repo can never bring a symlink into the user's bare repo. The
    // `.git` directory is excluded by the copy (it is not importable content).
    const pushPath = await prepareSelectedImport(
      clonePath,
      importPath,
      normalizedSourcePath
    );
    const commitSha = await gitOutput(["-C", pushPath, "rev-parse", "HEAD"]);

    await runGit([
      "-C",
      pushPath,
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

/**
 * Build a clean, symlink-free import tree from the checked-out clone and commit
 * it, returning the path to push from. Handles BOTH a sub-path import and a
 * whole-repo import (empty `sourcePath`, meaning the clone root): in either case
 * the tree is rebuilt with {@link copyWithoutSymlinks}, which rejects/skips every
 * symlink entry and excludes the `.git` directory, so no symlink from the cloned
 * repo is ever copied, committed, or pushed into the user's bare repo.
 */
export async function prepareSelectedImport(
  clonePath: string,
  importPath: string,
  sourcePath: string
): Promise<string> {
  // Containment + symlink rejection. A symlink anywhere on the selected path
  // (the leaf OR any intermediate directory component) could redirect the copy
  // at an in-repo OR host file (the server .env, the SQLite DB, /etc/passwd,
  // another tenant's worktree). We therefore `lstat` the ORIGINAL selected path
  // and every component leading to it BEFORE resolving any realpath, and reject
  // the moment a symlink is seen. Only after the original path is proven
  // symlink-free do we realpath it to confirm containment. An empty `sourcePath`
  // resolves to the clone root (a real directory), so the whole-repo case flows
  // through the same symlink-stripping directory copy below.
  const realCloneRoot = await realpath(clonePath);
  const source = join(realCloneRoot, sourcePath);

  // lstat the literal selected path (no symlink following). Reject a missing
  // path or a symlinked leaf.
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(source);
  } catch {
    throw new Error("Selected GitHub path was not found");
  }
  if (stat.isSymbolicLink()) {
    throw new Error("Selected GitHub path is a symlink and cannot be imported");
  }

  // Walk every intermediate directory component from the clone root down to the
  // selected path; if ANY is a symlink, reject (it could redirect the copy).
  await assertNoSymlinkComponents(realCloneRoot, source);

  // Now that the literal path is symlink-free, realpath is a no-op redirect and
  // serves purely to re-confirm lexical+real containment.
  const realSource = await realpath(source);
  if (!isInside(realCloneRoot, realSource)) {
    throw new Error("Selected GitHub path escapes the repository");
  }

  await mkdirp(importPath);
  if (stat.isDirectory()) {
    const entries = await readdir(source);
    for (const entry of entries) {
      if (entry === ".git") continue;
      await copyWithoutSymlinks(
        join(source, entry),
        join(importPath, entry),
        realCloneRoot
      );
    }
  } else if (stat.isFile()) {
    await copyWithoutSymlinks(
      source,
      join(importPath, basename(source)),
      realCloneRoot
    );
  } else {
    throw new Error("Selected GitHub path is not a regular file or directory");
  }

  await runGit(["-C", importPath, "init"]);
  await runGit(["-C", importPath, "config", "user.email", "github-sync@patra.local"]);
  await runGit(["-C", importPath, "config", "user.name", "Patra GitHub sync"]);
  await runGit(["-C", importPath, "add", "."]);
  await runGit([
    "-C",
    importPath,
    "commit",
    "-m",
    `Import ${sourcePath || "repository root"}`,
  ]);
  return importPath;
}

/**
 * Reject if any path component between `base` (exclusive) and `target`
 * (inclusive of intermediate directories, exclusive of the already-checked
 * leaf) is a symlink. `lstat`s each component literally so a symlinked
 * directory in the middle of the selected path cannot redirect the traversal.
 */
async function assertNoSymlinkComponents(
  base: string,
  target: string
): Promise<void> {
  const rel = relative(base, target);
  if (!rel || rel.startsWith("..")) return;
  const segments = rel.split(sep).filter(Boolean);
  // Check every intermediate component (the leaf itself is checked by callers).
  let current = base;
  for (let i = 0; i < segments.length - 1; i++) {
    current = join(current, segments[i]);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new Error("Selected GitHub path traverses a symlink and cannot be imported");
    }
  }
}

/** True when `candidate` is `base` or lives inside it (both absolute). */
function isInside(base: string, candidate: string): boolean {
  const rel = relative(resolve(base), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

/**
 * Recursively copy `src` to `dest`, REJECTING any symlink entry so the imported
 * (and ultimately committed) tree contains no symlinks. Regular files/dirs are
 * copied; a symlink — at the leaf OR any directory component, pointing inside OR
 * outside the clone — is skipped. Each entry is `lstat`'d (never followed)
 * before recursing, and real sources are re-verified to stay within `cloneRoot`.
 */
async function copyWithoutSymlinks(
  src: string,
  dest: string,
  cloneRoot: string
): Promise<void> {
  const info = await lstat(src);
  if (info.isSymbolicLink()) {
    // Drop symlinks entirely; never materialize them in the import tree —
    // regardless of whether the target is inside or outside the clone.
    return;
  }
  if (info.isDirectory()) {
    // Guard against a real directory that resolves outside the clone.
    const realDir = await realpath(src);
    if (!isInside(cloneRoot, realDir)) return;
    await mkdirp(dest);
    const entries = await readdir(src);
    for (const entry of entries) {
      if (entry === ".git") continue;
      await copyWithoutSymlinks(join(src, entry), join(dest, entry), cloneRoot);
    }
    return;
  }
  if (!info.isFile()) return; // skip sockets/fifos/devices
  const realFile = await realpath(src);
  if (!isInside(cloneRoot, realFile)) return;
  await cp(src, dest, { force: true });
}

async function createGitAuthEnv(
  tmpDir: string,
  token: string
): Promise<Record<string, string>> {
  const askpassPath = join(tmpDir, "github-askpass.sh");
  await writeFile(
    askpassPath,
    [
      "#!/bin/sh",
      'case "$1" in',
      '  *Username*) echo "x-access-token" ;;',
      `  *Password*) echo ${JSON.stringify(token)} ;;`,
      '  *) echo "" ;;',
      "esac",
      "",
    ].join("\n"),
    { mode: 0o700 }
  );

  return {
    GIT_ASKPASS: askpassPath,
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function mkdirp(path: string): Promise<void> {
  await Bun.$`mkdir -p ${path}`.quiet();
}

async function listGitHubInstallationRepos(
  token: string,
  ownerLogin: string
): Promise<GitHubRepositoryOption[]> {
  const repos: GitHubRepositoryOption[] = [];
  for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
    const url = new URL("https://api.github.com/installation/repositories");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const res = await fetch(url, { headers: githubApiHeaders(token) });
    if (!res.ok) {
      throw new Error(`GitHub repository lookup failed: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as {
      repositories?: {
        full_name?: string;
        clone_url?: string;
        default_branch?: string;
        private?: boolean;
        pushed_at?: string | null;
        updated_at?: string | null;
        owner?: { login?: string };
      }[];
    };
    const pageRepos = body.repositories ?? [];
    for (const repo of pageRepos) {
      if (!repo.full_name || !repo.clone_url || !repo.default_branch) continue;
      const normalizedUrl = normalizeGitHubRepoUrl(repo.clone_url);
      const repoOwnerLogin = repo.owner?.login ?? repo.full_name.split("/")[0] ?? "";
      if (!normalizedUrl) continue;
      if (ownerLogin && repoOwnerLogin.toLowerCase() !== ownerLogin.toLowerCase()) {
        continue;
      }
      repos.push({
        fullName: repo.full_name,
        repoUrl: normalizedUrl,
        defaultBranch: repo.default_branch,
        private: Boolean(repo.private),
        pushedAt: repo.pushed_at ?? null,
        updatedAt: repo.updated_at ?? null,
        ownerLogin: repoOwnerLogin,
      });
    }

    if (pageRepos.length < 100) break;
  }

  return repos;
}

function organizationsFromRepos(
  repos: GitHubRepositoryOption[]
): GitHubOrganizationOption[] {
  const organizations = new Map<string, GitHubOrganizationOption>();
  for (const repo of repos) {
    const key = repo.ownerLogin.toLowerCase();
    if (!key || organizations.has(key)) continue;
    organizations.set(key, {
      login: repo.ownerLogin,
      description: null,
      avatarUrl: null,
    });
  }
  return [...organizations.values()].sort((a, b) => a.login.localeCompare(b.login));
}

function normalizeCredential(credential: GitHubCredential | string): GitHubCredential {
  if (typeof credential === "string") return { token: credential, type: "pat" };
  return credential;
}

function parseGitHubRepo(normalizedUrl: string): { owner: string; repo: string } {
  const parsed = new URL(normalizedUrl);
  const [owner, repoWithGit] = parsed.pathname.replace(/^\/|\/$/g, "").split("/");
  return { owner, repo: repoWithGit.replace(/\.git$/, "") };
}

function normalizeGitHubOwnerLogin(ownerLogin: string | null | undefined): string | null {
  const value = ownerLogin?.trim() ?? "";
  if (!value) return "";
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) return null;
  return value;
}

function githubApiHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "patra",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

/**
 * Sanitize a git failure message before it leaves the server (it is thrown,
 * persisted to the github_syncs row, and returned to the client). Strips
 * embedded credentials AND server-internal filesystem paths — the fallback
 * `git <args> failed` text embeds full temp-clone paths and `repo.diskPath`,
 * which would otherwise leak the host's directory layout. Server-side console
 * logging may still keep the full detail.
 */
export function sanitizeGitError(message: string): string {
  return redactInternalPaths(redactSensitiveGitOutput(message));
}

async function runGit(args: string[], env?: Record<string, string>): Promise<void> {
  // Run via the shared process-group timeout helper so a runaway git AND its
  // children (git-remote-https, helpers) are killed as a unit, not orphaned.
  // GIT_LITERAL_PATHSPECS is forced so user-controlled paths/branches passed to
  // git can never be reinterpreted as pathspec magic.
  const result = await spawnWithTimeout(["git", ...args], {
    env: { ...process.env, ...(env ?? {}), GIT_LITERAL_PATHSPECS: "1" },
  });
  if (result.exitCode !== 0) {
    throw new Error(
      sanitizeGitError(result.stderr.trim() || `git ${args.join(" ")} failed`)
    );
  }
}

async function gitOutput(args: string[]): Promise<string> {
  const result = await spawnWithTimeout(["git", ...args], {
    env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
  });
  if (result.exitCode !== 0) {
    throw new Error(
      sanitizeGitError(result.stderr.trim() || `git ${args.join(" ")} failed`)
    );
  }
  return result.stdout.trim();
}
