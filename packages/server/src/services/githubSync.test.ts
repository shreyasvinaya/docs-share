import { afterEach, describe, expect, test } from "bun:test";
import {
  filterGitHubTree,
  listGitHubAccessibleRepos,
  listGitHubBranches,
  listGitHubOrganizations,
  normalizeGitBranch,
  normalizeGitHubImportPath,
  normalizeGitHubRepoUrl,
  orderGitHubBranches,
  redactSensitiveGitOutput,
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

  test("limits repositories to a selected organization", async () => {
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
            private: false,
            pushed_at: "2026-06-11T10:00:00Z",
            updated_at: "2026-06-12T10:00:00Z",
            owner: { login: "acme" },
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
        private: false,
        pushedAt: "2026-06-11T10:00:00Z",
        updatedAt: "2026-06-12T10:00:00Z",
        ownerLogin: "acme",
      },
    ]);
    expect(requestedUrl).toContain("/orgs/acme/repos?");
    expect(requestedUrl).toContain("type=all");
    expect(requestedUrl).toContain("sort=updated");
  });
});

describe("listGitHubOrganizations", () => {
  test("returns organization choices for the connected token", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (input, init) => {
      requestedUrl = String(input);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer user-token");
      return new Response(
        JSON.stringify([
          { login: "acme", description: "Acme Docs", avatar_url: "https://example.com/acme.png" },
          { login: "octo-org", description: null, avatar_url: null },
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
    ]);
    expect(requestedUrl).toContain("/user/orgs?");
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
