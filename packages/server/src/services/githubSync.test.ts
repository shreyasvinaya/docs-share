import { describe, expect, test } from "bun:test";
import {
  normalizeGitBranch,
  normalizeGitHubRepoUrl,
} from "./githubSync.js";

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
