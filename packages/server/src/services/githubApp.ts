import { createSign } from "crypto";
import { config } from "../lib/config.js";

export interface GitHubInstallationAccount {
  login: string | null;
  type: string | null;
}

export interface GitHubInstallationToken {
  token: string;
  expiresAt: string;
}

export function isGitHubAppConfigured(): boolean {
  return Boolean(
    config.GITHUB_APP_ID &&
      config.GITHUB_APP_SLUG &&
      config.GITHUB_APP_PRIVATE_KEY
  );
}

export function createGitHubAppInstallUrl(state: string): string {
  if (!config.GITHUB_APP_SLUG) {
    throw new Error("GitHub App slug is not configured");
  }

  const url = new URL(`https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function getGitHubInstallationAccount(
  installationId: string
): Promise<GitHubInstallationAccount> {
  const res = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: githubAppHeaders(createGitHubAppJwt()),
  });

  if (!res.ok) {
    throw new Error(`GitHub installation lookup failed: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as {
    account?: { login?: string | null; type?: string | null };
  };
  return {
    login: body.account?.login ?? null,
    type: body.account?.type ?? null,
  };
}

export async function createGitHubInstallationToken(
  installationId: string
): Promise<GitHubInstallationToken> {
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: githubAppHeaders(createGitHubAppJwt()),
    }
  );

  if (!res.ok) {
    throw new Error(`GitHub installation token failed: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as { token?: string; expires_at?: string };
  if (!body.token || !body.expires_at) {
    throw new Error("GitHub installation token response was missing token data");
  }

  return { token: body.token, expiresAt: body.expires_at };
}

function createGitHubAppJwt(now = Math.floor(Date.now() / 1000)): string {
  if (!config.GITHUB_APP_ID || !config.GITHUB_APP_PRIVATE_KEY) {
    throw new Error("GitHub App credentials are not configured");
  }

  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: config.GITHUB_APP_ID,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .end()
    .sign(normalizePrivateKey(config.GITHUB_APP_PRIVATE_KEY), "base64url");
  return `${signingInput}.${signature}`;
}

function githubAppHeaders(jwt: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${jwt}`,
    "User-Agent": "docs-share",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, "\n");
}
