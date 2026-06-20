const DEFAULT_DEPLOYMENT_NAME = "Docs Share";
const DEFAULT_SECRETS = new Set([
  "dev-secret-change-in-production",
  "dev-draft-content-secret-change-in-production",
  "dev-hook-secret-change-in-production",
  "dev-github-token-secret-change-in-production",
]);

export interface DeploymentEnv {
  NODE_ENV?: string;
  APP_ENV?: string;
  APP_URL?: string;
  API_URL?: string;
  CONTENT_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  SESSION_SECRET?: string;
  DRAFT_CONTENT_SECRET?: string;
  HOOK_SECRET?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_TOKEN_SECRET?: string;
  ENABLE_DEV_LOGIN?: string;
  SYSADMIN_EMAILS?: string;
  DEPLOYMENT_NAME?: string;
}

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

export function normalizeDeploymentName(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized || DEFAULT_DEPLOYMENT_NAME;
}

export function parseSysadminEmails(value: string | null | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

export function isSysadminEmail(email: string, sysadminEmails: string[]): boolean {
  return sysadminEmails.includes(email.trim().toLowerCase());
}

export function deploymentRoleForEmail(
  email: string,
  sysadminEmails: string[]
): "user" | "sysadmin" {
  return isSysadminEmail(email, sysadminEmails) ? "sysadmin" : "user";
}

export function buildSetupStatus(env: DeploymentEnv): SetupStatus {
  const production = env.NODE_ENV === "production" || env.APP_ENV === "production";
  const sysadminEmails = parseSysadminEmails(env.SYSADMIN_EMAILS);
  const googleConfigured = Boolean(
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI
  );
  const githubAppConfigured = Boolean(
    env.GITHUB_APP_ID && env.GITHUB_APP_SLUG && env.GITHUB_APP_PRIVATE_KEY
  );
  const githubPatFallbackConfigured = isStrongSecret(env.GITHUB_TOKEN_SECRET);
  const productionSecretsConfigured = [
    env.SESSION_SECRET,
    env.DRAFT_CONTENT_SECRET,
    env.HOOK_SECRET,
    env.GITHUB_TOKEN_SECRET,
  ].every(isStrongSecret);

  return {
    deploymentName: normalizeDeploymentName(env.DEPLOYMENT_NAME),
    environment: {
      production,
      appUrl: check(Boolean(env.APP_URL), "App URL", "Set APP_URL to the public app URL."),
      contentOrigin: check(
        Boolean(env.CONTENT_ORIGIN),
        "Content origin",
        "Set CONTENT_ORIGIN to the public content-serving origin."
      ),
      devLogin: check(
        !production || env.ENABLE_DEV_LOGIN !== "true",
        "Development login",
        production
          ? "Disable ENABLE_DEV_LOGIN in production."
          : "Development login may be enabled for local setup."
      ),
    },
    sysadmin: check(
      sysadminEmails.length > 0,
      "Sysadmin users",
      "Set SYSADMIN_EMAILS to a comma-separated list of deployment admin emails."
    ),
    authentication: {
      googleOAuth: check(
        googleConfigured,
        "Google OAuth",
        "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI."
      ),
    },
    integrations: {
      githubApp: check(
        githubAppConfigured,
        "GitHub App",
        "Set GITHUB_APP_ID, GITHUB_APP_SLUG, and GITHUB_APP_PRIVATE_KEY."
      ),
      githubPatFallback: check(
        githubPatFallbackConfigured,
        "GitHub PAT fallback",
        "Set GITHUB_TOKEN_SECRET so fallback tokens can be encrypted at rest."
      ),
    },
    security: {
      productionSecrets: check(
        productionSecretsConfigured,
        "Production secrets",
        "Use unique 32+ character values for session, draft, hook, and token secrets."
      ),
    },
  };
}

function check(configured: boolean, label: string, detail: string): SetupCheck {
  return { configured, label, detail };
}

function isStrongSecret(value: string | null | undefined): boolean {
  return Boolean(value && value.length >= 32 && !DEFAULT_SECRETS.has(value));
}
