import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

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
  });
  return data?.deploymentName ?? "Docs Share";
}
