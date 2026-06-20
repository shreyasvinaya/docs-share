import type { GitHubRepositoryOption } from "@/hooks/use-files";

export function getGitHubPrivateRepoNotice(params: {
  tokenConnected: boolean;
  repositories: GitHubRepositoryOption[] | undefined;
  isLoading: boolean;
  isError: boolean;
  ownerFilter: string;
}): string | null {
  if (
    !params.tokenConnected ||
    params.isLoading ||
    params.isError ||
    !params.repositories?.length ||
    params.repositories.some((repository) => repository.private)
  ) {
    return null;
  }

  const scope = params.ownerFilter
    ? ` for ${params.ownerFilter}`
    : "";
  return `GitHub is only returning public repositories${scope}. If you expected private repositories, update the GitHub App repository access and confirm organization approval or SSO.`;
}
