import { describe, expect, test } from "bun:test";
import { getGitHubIntegrationView } from "./github-integration-status";
import type { GitHubTokenStatus } from "@/hooks/use-auth";

function status(overrides: Partial<GitHubTokenStatus> = {}): GitHubTokenStatus {
  return {
    connected: false,
    connectionType: null,
    configured: false,
    updatedAt: null,
    installationId: null,
    accountLogin: null,
    accountType: null,
    ...overrides,
  };
}

describe("getGitHubIntegrationView", () => {
  test("shows PAT fallback when the GitHub App is not configured", () => {
    expect(getGitHubIntegrationView(status()).showPatFallback).toBe(true);
  });

  test("keeps PAT fallback available when a legacy PAT is connected", () => {
    expect(
      getGitHubIntegrationView(
        status({ connected: true, connectionType: "pat" })
      ).showPatFallback
    ).toBe(true);
  });

  test("hides PAT fallback by default when a GitHub App is configured", () => {
    expect(
      getGitHubIntegrationView(status({ configured: true })).showPatFallback
    ).toBe(false);
  });
});
