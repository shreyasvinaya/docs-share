import { afterEach, describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  filterGitHubTree,
  listGitHubAccessibleRepos,
  listGitHubBranches,
  listGitHubOrganizations,
  normalizeGitBranch,
  normalizeGitHubImportPath,
  normalizeGitHubRepoUrl,
  orderGitHubBranches,
  prepareSelectedImport,
  redactSensitiveGitOutput,
  sanitizeGitError,
} from "./githubSync.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("normalizeGitHubRepoUrl", () => {
  test("accepts public GitHub repository URLs", () => {
    expect(normalizeGitHubRepoUrl("https://github.com/acme/site")).toBe(
      "https://github.com/acme/site.git"
    );
    expect(normalizeGitHubRepoUrl("https://github.com/acme/site.git")).toBe(
      "https://github.com/acme/site.git"
    );
  });

  test("rejects non-GitHub and malformed URLs", () => {
    expect(normalizeGitHubRepoUrl("git@github.com:acme/site.git")).toBeNull();
    expect(normalizeGitHubRepoUrl("https://example.com/acme/site")).toBeNull();
    expect(normalizeGitHubRepoUrl("https://github.com/acme")).toBeNull();
    expect(normalizeGitHubRepoUrl("not a url")).toBeNull();
  });

  test("redacts GitHub tokens from git output", () => {
    const output =
      "fatal: Authentication failed for https://x-access-token:ghp_secret@github.com/acme/private.git github_pat_abc123";

    const redacted = redactSensitiveGitOutput(output);
    expect(redacted).not.toContain("ghp_secret");
    expect(redacted).not.toContain("github_pat_abc123");
    expect(redacted).toContain("[redacted]");
  });
});

describe("sanitizeGitError (FIX 1: no internal paths reach the client/DB)", () => {
  test("strips the temp clone path AND repo.diskPath from a forced git error", () => {
    // A realistic fallback git error: it embeds the real OS temp clone path and
    // the server-internal bare-repo diskPath under DATA_DIR. Neither may survive
    // into the message that is persisted to the github_syncs row / returned.
    const clonePath = join(tmpdir(), "ds-github-sync-abc123", "source");
    const diskPath = "/srv/docs-share/data/repos/repo_42.git";
    const raw =
      `git -C ${clonePath} push ${diskPath} HEAD:refs/heads/main --force failed: ` +
      `fatal: could not create work tree dir '${clonePath}'`;

    const sanitized = sanitizeGitError(raw);

    // The OS temp dir is a default base dir, so the clone path is gone.
    expect(sanitized).not.toContain(tmpdir());
    expect(sanitized).not.toContain("ds-github-sync-abc123");
    // The diskPath under the (default ./data) DATA_DIR... but with a custom
    // absolute DATA_DIR like /srv/... the catch-all still removes it.
    expect(sanitized).not.toContain(diskPath);
    expect(sanitized).not.toContain("repo_42.git");
    expect(sanitized).toContain("[path]");
  });

  test("still redacts embedded credentials while removing paths", () => {
    const raw =
      `fatal: clone of https://x-access-token:ghp_topsecret@github.com/acme/x.git ` +
      `into ${join(tmpdir(), "ds-github-sync-xyz", "source")} failed`;
    const sanitized = sanitizeGitError(raw);
    expect(sanitized).not.toContain("ghp_topsecret");
    expect(sanitized).not.toContain("ds-github-sync-xyz");
    expect(sanitized).toContain("[redacted]");
    expect(sanitized).toContain("[path]");
  });
});

describe("normalizeGitBranch", () => {
  test("defaults to main and accepts normal branch names", () => {
    expect(normalizeGitBranch(undefined)).toBe("main");
    expect(normalizeGitBranch("docs-site")).toBe("docs-site");
    expect(normalizeGitBranch("release/v1")).toBe("release/v1");
  });

  test("rejects unsafe branch names", () => {
    expect(normalizeGitBranch("../main")).toBeNull();
    expect(normalizeGitBranch("-main")).toBeNull();
    expect(normalizeGitBranch("feature branch")).toBeNull();
    expect(normalizeGitBranch("main\0")).toBeNull();
  });
});

describe("orderGitHubBranches", () => {
  test("places common branch names first when present", () => {
    expect(
      orderGitHubBranches(["feature-x", "gh-pages", "master", "main", "staging"])
    ).toEqual(["main", "master", "staging", "gh-pages", "feature-x"]);
  });
});

describe("listGitHubAccessibleRepos", () => {
  test("returns token-scoped repositories from GitHub in last-updated order", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input, init) => {
      requestedUrls.push(String(input));
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer user-token");
      return new Response(
        JSON.stringify([
          {
            full_name: "acme/private-docs",
            clone_url: "https://github.com/acme/private-docs.git",
            default_branch: "staging",
            private: true,
            pushed_at: "2026-06-12T10:00:00Z",
            updated_at: "2026-06-12T12:00:00Z",
            owner: { login: "acme" },
          },
        ]),
        { status: 200 }
      );
    }) as typeof fetch;

    await expect(listGitHubAccessibleRepos("user-token")).resolves.toEqual([
      {
        fullName: "acme/private-docs",
        repoUrl: "https://github.com/acme/private-docs.git",
        defaultBranch: "staging",
        private: true,
        pushedAt: "2026-06-12T10:00:00Z",
        updatedAt: "2026-06-12T12:00:00Z",
        ownerLogin: "acme",
      },
    ]);
    expect(requestedUrls[0]).toContain("/user/repos?");
    expect(requestedUrls[0]).toContain("visibility=all");
    expect(requestedUrls[0]).toContain("sort=updated");
  });

  test("does not call GitHub when no token is available", async () => {
    globalThis.fetch = (async () => {
      throw new Error("fetch should not be called");
    }) as unknown as typeof fetch;

    await expect(listGitHubAccessibleRepos("")).resolves.toEqual([]);
  });

  test("filters accessible private repositories to a selected organization", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input, init) => {
      requestedUrl = String(input);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer user-token");
      return new Response(
        JSON.stringify([
          {
            full_name: "acme/site",
            clone_url: "https://github.com/acme/site.git",
            default_branch: "main",
            private: true,
            pushed_at: "2026-06-11T10:00:00Z",
            updated_at: "2026-06-12T10:00:00Z",
            owner: { login: "acme" },
          },
          {
            full_name: "octo-org/public-site",
            clone_url: "https://github.com/octo-org/public-site.git",
            default_branch: "main",
            private: false,
            pushed_at: "2026-06-10T10:00:00Z",
            updated_at: "2026-06-11T10:00:00Z",
            owner: { login: "octo-org" },
          },
        ]),
        { status: 200 }
      );
    }) as typeof fetch;

    await expect(listGitHubAccessibleRepos("user-token", "acme")).resolves.toEqual([
      {
        fullName: "acme/site",
        repoUrl: "https://github.com/acme/site.git",
        defaultBranch: "main",
        private: true,
        pushedAt: "2026-06-11T10:00:00Z",
        updatedAt: "2026-06-12T10:00:00Z",
        ownerLogin: "acme",
      },
    ]);
    expect(requestedUrl).toContain("/user/repos?");
    expect(requestedUrl).toContain("visibility=all");
    expect(requestedUrl).toContain("affiliation=owner%2Ccollaborator%2Corganization_member");
    expect(requestedUrl).toContain("sort=updated");
  });

  test("matches selected organization owners case-insensitively", async () => {
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toContain("/user/repos?");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer user-token");
      return new Response(
        JSON.stringify([
          {
            full_name: "Mstack-Chemicals/AgentOrg",
            clone_url: "https://github.com/Mstack-Chemicals/AgentOrg.git",
            default_branch: "main",
            private: false,
            pushed_at: "2026-06-12T10:00:00Z",
            updated_at: "2026-06-12T10:00:00Z",
            owner: { login: "Mstack-Chemicals" },
          },
        ]),
        { status: 200 }
      );
    }) as typeof fetch;

    await expect(listGitHubAccessibleRepos("user-token", "mstack-chemicals")).resolves.toEqual([
      {
        fullName: "Mstack-Chemicals/AgentOrg",
        repoUrl: "https://github.com/Mstack-Chemicals/AgentOrg.git",
        defaultBranch: "main",
        private: false,
        pushedAt: "2026-06-12T10:00:00Z",
        updatedAt: "2026-06-12T10:00:00Z",
        ownerLogin: "Mstack-Chemicals",
      },
    ]);
  });

  test("uses installation repositories for GitHub App credentials", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input, init) => {
      requestedUrls.push(String(input));
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer installation-token"
      );
      return new Response(
        JSON.stringify({
          repositories: [
            {
              full_name: "acme/app-private-docs",
              clone_url: "https://github.com/acme/app-private-docs.git",
              default_branch: "main",
              private: true,
              pushed_at: "2026-06-12T10:00:00Z",
              updated_at: "2026-06-12T12:00:00Z",
              owner: { login: "acme" },
            },
          ],
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    await expect(
      listGitHubAccessibleRepos({
        token: "installation-token",
        type: "github_app",
      })
    ).resolves.toEqual([
      {
        fullName: "acme/app-private-docs",
        repoUrl: "https://github.com/acme/app-private-docs.git",
        defaultBranch: "main",
        private: true,
        pushedAt: "2026-06-12T10:00:00Z",
        updatedAt: "2026-06-12T12:00:00Z",
        ownerLogin: "acme",
      },
    ]);
    expect(requestedUrls[0]).toContain("/installation/repositories?");
  });
});

describe("listGitHubOrganizations", () => {
  test("returns organization choices for the connected token", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input, init) => {
      requestedUrls.push(String(input));
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer user-token");
      if (String(input).includes("/user/orgs?")) {
        return new Response(
          JSON.stringify([
            { login: "acme", description: "Acme Docs", avatar_url: "https://example.com/acme.png" },
            { login: "octo-org", description: null, avatar_url: null },
          ]),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify([
          {
            full_name: "acme/private-docs",
            clone_url: "https://github.com/acme/private-docs.git",
            default_branch: "main",
            private: true,
            owner: { login: "acme" },
          },
          {
            full_name: "zeta/private-docs",
            clone_url: "https://github.com/zeta/private-docs.git",
            default_branch: "main",
            private: true,
            owner: { login: "zeta" },
          },
        ]),
        { status: 200 }
      );
    }) as typeof fetch;

    await expect(listGitHubOrganizations("user-token")).resolves.toEqual([
      {
        login: "acme",
        description: "Acme Docs",
        avatarUrl: "https://example.com/acme.png",
      },
      {
        login: "octo-org",
        description: null,
        avatarUrl: null,
      },
      {
        login: "zeta",
        description: null,
        avatarUrl: null,
      },
    ]);
    expect(requestedUrls[0]).toContain("/user/orgs?");
    expect(requestedUrls[1]).toContain("/user/repos?");
  });

  test("uses accessible repository owners when GitHub org membership is empty", async () => {
    globalThis.fetch = (async (input, init) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer user-token");
      if (String(input).includes("/user/orgs?")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(
        JSON.stringify([
          {
            full_name: "acme/private-docs",
            clone_url: "https://github.com/acme/private-docs.git",
            default_branch: "main",
            private: true,
            owner: { login: "acme" },
          },
        ]),
        { status: 200 }
      );
    }) as typeof fetch;

    await expect(listGitHubOrganizations("user-token")).resolves.toEqual([
      {
        login: "acme",
        description: null,
        avatarUrl: null,
      },
    ]);
  });
});

describe("listGitHubBranches", () => {
  test("lists branches for the selected repository with recommended names first", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input, init) => {
      requestedUrl = String(input);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer user-token");
      return new Response(
        JSON.stringify([
          { name: "feature-x" },
          { name: "gh-pages" },
          { name: "main" },
          { name: "master" },
        ]),
        { status: 200 }
      );
    }) as typeof fetch;

    await expect(
      listGitHubBranches({
        repoUrl: "https://github.com/acme/site",
        token: "user-token",
      })
    ).resolves.toEqual(["main", "master", "gh-pages", "feature-x"]);
    expect(requestedUrl).toContain("/repos/acme/site/branches?");
  });
});

describe("normalizeGitHubImportPath", () => {
  test("accepts root, normal files, and nested folders", () => {
    expect(normalizeGitHubImportPath(undefined)).toBe("");
    expect(normalizeGitHubImportPath("")).toBe("");
    expect(normalizeGitHubImportPath("docs")).toBe("docs");
    expect(normalizeGitHubImportPath("docs/index.html")).toBe("docs/index.html");
  });

  test("rejects traversal, absolute, and git metadata paths", () => {
    expect(normalizeGitHubImportPath("../docs")).toBeNull();
    expect(normalizeGitHubImportPath("/docs")).toBeNull();
    expect(normalizeGitHubImportPath("docs/.git/config")).toBeNull();
    expect(normalizeGitHubImportPath("docs\0bad")).toBeNull();
  });
});

describe("filterGitHubTree", () => {
  test("returns picker nodes for root and selected subtrees", () => {
    const tree = [
      { path: "docs", type: "tree" as const },
      { path: "docs/index.html", type: "blob" as const, size: 120 },
      { path: "docs/assets/app.css", type: "blob" as const, size: 40 },
      { path: "README.md", type: "blob" as const, size: 80 },
    ];

    expect(filterGitHubTree(tree, "")).toEqual([
      { path: "docs", name: "docs", type: "directory", size: null },
      { path: "README.md", name: "README.md", type: "file", size: 80 },
    ]);
    expect(filterGitHubTree(tree, "docs")).toEqual([
      { path: "docs/assets", name: "assets", type: "directory", size: null },
      { path: "docs/index.html", name: "index.html", type: "file", size: 120 },
    ]);
  });
});

describe("prepareSelectedImport (symlink containment)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  async function scratch(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  }

  /** List committed files in an import repo (excludes .git). */
  async function importedFiles(importPath: string): Promise<string[]> {
    const entries = await readdir(importPath, { recursive: true });
    return entries.filter((e) => !e.startsWith(".git"));
  }

  test("does not materialize a symlink that escapes the clone", async () => {
    const root = await scratch("ds-sym-root-");
    const clonePath = join(root, "source");
    const importPath = join(root, "import");
    const outside = await scratch("ds-sym-outside-");
    await writeFile(join(outside, "secret.txt"), "HOST SECRET");

    await mkdir(join(clonePath, "docs"), { recursive: true });
    await writeFile(join(clonePath, "docs", "ok.html"), "<p>ok</p>");
    // A symlink inside the selected subtree pointing at the host secret.
    await symlink(
      join(outside, "secret.txt"),
      join(clonePath, "docs", "escape.txt")
    );

    await prepareSelectedImport(clonePath, importPath, "docs");

    const files = await importedFiles(importPath);
    // The normal file came across; the symlink did NOT.
    expect(files).toContain("ok.html");
    expect(files).not.toContain("escape.txt");
    // And nothing in the import tree is a symlink.
    for (const f of files) {
      const info = await lstat(join(importPath, f));
      expect(info.isSymbolicLink()).toBe(false);
    }
  });

  test("rejects when the selected path itself is a symlink escaping the clone", async () => {
    const root = await scratch("ds-sym-root2-");
    const clonePath = join(root, "source");
    const importPath = join(root, "import");
    const outside = await scratch("ds-sym-outside2-");
    await mkdir(outside, { recursive: true });

    await mkdir(clonePath, { recursive: true });
    // The selected sourcePath resolves (via symlink) outside the clone.
    await symlink(outside, join(clonePath, "docs"));

    await expect(
      prepareSelectedImport(clonePath, importPath, "docs")
    ).rejects.toThrow();
  });

  test("rejects a selected symlink that points at another IN-CLONE file", async () => {
    // FIX 4: a symlink whose target is inside the clone must STILL be rejected
    // (previously it was realpath'd first and copied as its target's content).
    const root = await scratch("ds-sym-root3-");
    const clonePath = join(root, "source");
    const importPath = join(root, "import");

    await mkdir(clonePath, { recursive: true });
    await writeFile(join(clonePath, "secret.md"), "IN-CLONE SECRET");
    // `link.md` -> `secret.md`, both inside the clone.
    await symlink(join(clonePath, "secret.md"), join(clonePath, "link.md"));

    await expect(
      prepareSelectedImport(clonePath, importPath, "link.md")
    ).rejects.toThrow();
  });

  test("rejects when an INTERMEDIATE path component is a symlink (even in-clone)", async () => {
    // FIX 4: a symlinked directory component must be rejected before any
    // realpath, regardless of whether it points inside the clone.
    const root = await scratch("ds-sym-root4-");
    const clonePath = join(root, "source");
    const importPath = join(root, "import");

    await mkdir(join(clonePath, "real"), { recursive: true });
    await writeFile(join(clonePath, "real", "ok.html"), "<p>ok</p>");
    // `linkdir` -> `real` (in-clone). Selecting `linkdir/ok.html` traverses it.
    await symlink(join(clonePath, "real"), join(clonePath, "linkdir"));

    await expect(
      prepareSelectedImport(clonePath, importPath, "linkdir/ok.html")
    ).rejects.toThrow();
  });

  test("does not copy an IN-CLONE symlink nested in a selected directory", async () => {
    // FIX 4: recursive copy must skip symlinks pointing inside the clone too.
    const root = await scratch("ds-sym-root5-");
    const clonePath = join(root, "source");
    const importPath = join(root, "import");

    await mkdir(join(clonePath, "docs"), { recursive: true });
    await writeFile(join(clonePath, "docs", "ok.html"), "<p>ok</p>");
    await writeFile(join(clonePath, "secret.md"), "IN-CLONE SECRET");
    // In-clone symlink inside the selected dir, pointing at an in-clone file.
    await symlink(
      join(clonePath, "secret.md"),
      join(clonePath, "docs", "alias.md")
    );

    await prepareSelectedImport(clonePath, importPath, "docs");

    const files = await importedFiles(importPath);
    expect(files).toContain("ok.html");
    expect(files).not.toContain("alias.md");
    for (const f of files) {
      const info = await lstat(join(importPath, f));
      expect(info.isSymbolicLink()).toBe(false);
    }
  });
});
