import type { GitHubTokenStatus } from "@/hooks/use-auth";

export interface GitHubIntegrationView {
  connectedWithApp: boolean;
  connectedWithLegacyPat: boolean;
  showPatFallback: boolean;
}

export function getGitHubIntegrationView(
  status: GitHubTokenStatus | undefined
): GitHubIntegrationView {
  const connectedWithApp = status?.connectionType === "github_app";
  const connectedWithLegacyPat = status?.connectionType === "pat";

  return {
    connectedWithApp,
    connectedWithLegacyPat,
    showPatFallback: status?.configured !== true || connectedWithLegacyPat,
  };
}
