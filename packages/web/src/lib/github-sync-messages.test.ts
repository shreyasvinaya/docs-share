import { describe, expect, test } from "bun:test";
import { getGitHubPrivateRepoNotice } from "./github-sync-messages";
import type { GitHubRepositoryOption } from "@/hooks/use-files";

function repo(
  fullName: string,
  overrides: Partial<GitHubRepositoryOption> = {}
): GitHubRepositoryOption {
  return {
    fullName,
    repoUrl: `https://github.com/${fullName}.git`,
    defaultBranch: "main",
    private: false,
    pushedAt: null,
    updatedAt: null,
    ownerLogin: fullName.split("/")[0] ?? "",
    ...overrides,
  };
}

describe("getGitHubPrivateRepoNotice", () => {
  test("warns when a connected GitHub App only returns public repositories", () => {
    expect(
      getGitHubPrivateRepoNotice({
        tokenConnected: true,
        repositories: [repo("Mstack-Chemicals/AgentOrg")],
        isLoading: false,
        isError: false,
        ownerFilter: "Mstack-Chemicals",
      })
    ).toContain("update the GitHub App repository access");
  });

  test("does not warn when private repositories are present", () => {
    expect(
      getGitHubPrivateRepoNotice({
        tokenConnected: true,
        repositories: [repo("Mstack-Chemicals/private-docs", { private: true })],
        isLoading: false,
        isError: false,
        ownerFilter: "Mstack-Chemicals",
      })
    ).toBeNull();
  });
});
