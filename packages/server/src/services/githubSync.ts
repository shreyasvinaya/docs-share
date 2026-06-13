import { cp, mkdtemp, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
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
  token: string,
  ownerLogin = ""
): Promise<GitHubRepositoryOption[]> {
  if (!token.trim()) return [];
  const normalizedOwnerLogin = normalizeGitHubOwnerLogin(ownerLogin);
  if (normalizedOwnerLogin === null) {
    throw new Error("Invalid GitHub organization name");
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
  token: string
): Promise<GitHubOrganizationOption[]> {
  if (!token.trim()) return [];

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

  const accessibleRepos = await listGitHubAccessibleRepos(token);
  for (const repo of accessibleRepos) {
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

export async function syncGitHubRepo(
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
      "--branch",
      normalizedBranch,
      normalizedUrl,
      clonePath,
    ], gitEnv);

    const pushPath = normalizedSourcePath
      ? await prepareSelectedImport(clonePath, importPath, normalizedSourcePath)
      : clonePath;
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

async function prepareSelectedImport(
  clonePath: string,
  importPath: string,
  sourcePath: string
): Promise<string> {
  const source = join(clonePath, sourcePath);
  const sourceFile = Bun.file(source);
  const exists = await sourceFile.exists();
  if (!exists) throw new Error("Selected GitHub path was not found");

  await mkdirp(importPath);
  const stat = await sourceFile.stat();
  if (stat.isDirectory()) {
    const entries = await readdir(source);
    for (const entry of entries) {
      if (entry === ".git") continue;
      await cp(join(source, entry), join(importPath, entry), {
        recursive: true,
        force: true,
      });
    }
  } else {
    await cp(source, join(importPath, basename(source)), { force: true });
  }

  await runGit(["-C", importPath, "init"]);
  await runGit(["-C", importPath, "config", "user.email", "github-sync@docs-share.local"]);
  await runGit(["-C", importPath, "config", "user.name", "docs-share GitHub sync"]);
  await runGit(["-C", importPath, "add", "."]);
  await runGit(["-C", importPath, "commit", "-m", `Import ${sourcePath}`]);
  return importPath;
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
    "User-Agent": "docs-share",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

async function runGit(args: string[], env?: Record<string, string>): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: env ? { ...process.env, ...env } : process.env,
  });
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(
      redactSensitiveGitOutput(stderr.trim() || `git ${args.join(" ")} failed`)
    );
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
    throw new Error(
      redactSensitiveGitOutput(stderr.trim() || `git ${args.join(" ")} failed`)
    );
  }
  return stdout.trim();
}
