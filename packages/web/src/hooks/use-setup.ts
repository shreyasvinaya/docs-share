import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { IS_PUBLIC_SITE } from "@/lib/public-site";

export interface SetupCheck {
  configured: boolean;
  label: string;
  detail: string;
}

export interface SetupStatus {
  deploymentName: string;
  environment: {
    production: boolean;
    appUrl: SetupCheck;
    contentOrigin: SetupCheck;
    devLogin: SetupCheck;
  };
  sysadmin: SetupCheck;
  authentication: {
    googleOAuth: SetupCheck;
  };
  integrations: {
    githubApp: SetupCheck;
    githubPatFallback: SetupCheck;
  };
  notifications: {
    email: SetupCheck;
    slack: SetupCheck;
  };
  security: {
    productionSecrets: SetupCheck;
  };
}

export function useSetupStatus() {
  return useQuery({
    queryKey: ["setup-status"],
    queryFn: () => api.get<SetupStatus>("/api/setup/status"),
  });
}

export function useDeploymentName() {
  const { data } = useQuery({
    queryKey: ["deployment-branding"],
    queryFn: () => api.get<{ deploymentName: string }>("/api/setup/branding"),
    staleTime: 5 * 60 * 1000,
    // The static GitHub Pages build has no server; skip the request and use the
    // default name so the public site never makes a failing API call.
    enabled: !IS_PUBLIC_SITE,
  });
  return data?.deploymentName ?? "Patra";
}
