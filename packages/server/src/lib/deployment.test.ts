import { describe, expect, test } from "bun:test";
import {
  buildSetupStatus,
  isSysadminEmail,
  normalizeDeploymentName,
  parseSysadminEmails,
} from "./deployment.js";

describe("deployment configuration", () => {
  test("normalizes deployment names with a stable default", () => {
    expect(normalizeDeploymentName("  Acme Docs  ")).toBe("Acme Docs");
    expect(normalizeDeploymentName("")).toBe("Docs Share");
    expect(normalizeDeploymentName("   ")).toBe("Docs Share");
  });

  test("matches sysadmin emails case-insensitively", () => {
    const sysadmins = parseSysadminEmails("Admin@Example.com, ops@example.com");

    expect(sysadmins).toEqual(["admin@example.com", "ops@example.com"]);
    expect(isSysadminEmail("ADMIN@example.com", sysadmins)).toBe(true);
    expect(isSysadminEmail("user@example.com", sysadmins)).toBe(false);
  });

  test("builds setup status without exposing secret values", () => {
    const status = buildSetupStatus({
      NODE_ENV: "production",
      APP_URL: "https://docs.example.com",
      API_URL: "https://docs.example.com",
      CONTENT_ORIGIN: "https://content.docs.example.com",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_REDIRECT_URI: "https://docs.example.com/api/auth/google/callback",
      SESSION_SECRET: "x".repeat(32),
      DRAFT_CONTENT_SECRET: "y".repeat(32),
      HOOK_SECRET: "z".repeat(32),
      GITHUB_APP_ID: "12345",
      GITHUB_APP_SLUG: "acme-docs-share",
      GITHUB_APP_PRIVATE_KEY: "private-key",
      GITHUB_TOKEN_SECRET: "g".repeat(32),
      ENABLE_DEV_LOGIN: "false",
      SYSADMIN_EMAILS: "admin@example.com",
      DEPLOYMENT_NAME: "Acme Docs",
      EMAIL_FROM: "docs@example.com",
      RESEND_API_KEY: "re_secret_key",
      SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/secret",
    });

    expect(status.deploymentName).toBe("Acme Docs");
    expect(status.sysadmin.configured).toBe(true);
    expect(status.authentication.googleOAuth.configured).toBe(true);
    expect(status.integrations.githubApp.configured).toBe(true);
    expect(status.notifications.email.configured).toBe(true);
    expect(status.notifications.slack.configured).toBe(true);
    expect(status.security.productionSecrets.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain("private-key");
    expect(JSON.stringify(status)).not.toContain("client-secret");
    expect(JSON.stringify(status)).not.toContain("re_secret_key");
    expect(JSON.stringify(status)).not.toContain("hooks.slack.com");
  });

  test("flags missing email and slack notification channels", () => {
    const status = buildSetupStatus({});

    expect(status.notifications.email.configured).toBe(false);
    expect(status.notifications.slack.configured).toBe(false);
  });
});
