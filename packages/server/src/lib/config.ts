import { resolve } from "path";
import { assertProductionSecret, isProduction } from "./security.js";

function env(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

function envRequired(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

export const config = {
  PORT: parseInt(env("PORT", "3000")),
  HOST: env("HOST", "0.0.0.0"),

  APP_URL: env("APP_URL", "http://localhost:5173"),
  API_URL: env("API_URL", "http://localhost:3000"),

  DATA_DIR: resolve(env("DATA_DIR", "./data")),
  WEB_DIST_DIR: env("WEB_DIST_DIR", ""),
  ALLOW_INSECURE_APP_URL: env("ALLOW_INSECURE_APP_URL", "false"),

  GOOGLE_CLIENT_ID: env("GOOGLE_CLIENT_ID", ""),
  GOOGLE_CLIENT_SECRET: env("GOOGLE_CLIENT_SECRET", ""),
  GOOGLE_REDIRECT_URI: env(
    "GOOGLE_REDIRECT_URI",
    "http://localhost:3000/api/auth/google/callback"
  ),

  SESSION_SECRET: env("SESSION_SECRET", "dev-secret-change-in-production"),
  DRAFT_CONTENT_SECRET: env(
    "DRAFT_CONTENT_SECRET",
    "dev-draft-content-secret-change-in-production"
  ),
  HOOK_SECRET: env("HOOK_SECRET", "dev-hook-secret-change-in-production"),
  HOOK_BASE_URL: env("HOOK_BASE_URL", `http://localhost:${env("PORT", "3000")}`),

  CONTENT_ORIGIN: env("CONTENT_ORIGIN", "http://localhost:3000"),

  GITHUB_TOKEN_SECRET: env(
    "GITHUB_TOKEN_SECRET",
    "dev-github-token-secret-change-in-production"
  ),

  EMAIL_FROM: env("EMAIL_FROM", ""),
  RESEND_API_KEY: env("RESEND_API_KEY", ""),
  SLACK_WEBHOOK_URL: env("SLACK_WEBHOOK_URL", ""),

  // Background scheduler. Set SCHEDULER_ENABLED=false to disable all jobs, or
  // set an individual interval to 0 to disable just that job.
  SCHEDULER_ENABLED: env("SCHEDULER_ENABLED", "true") !== "false",
  // Expired-share cleanup sweep interval (ms). Default: every 15 minutes.
  EXPIRED_SHARE_SWEEP_INTERVAL_MS: parseInt(
    env("EXPIRED_SHARE_SWEEP_INTERVAL_MS", "900000")
  ),
  // GitHub sync retry interval (ms). Default: every 10 minutes.
  GITHUB_SYNC_RETRY_INTERVAL_MS: parseInt(
    env("GITHUB_SYNC_RETRY_INTERVAL_MS", "600000")
  ),
  // Maximum number of failed syncs to retry per sweep.
  GITHUB_SYNC_RETRY_BATCH: parseInt(env("GITHUB_SYNC_RETRY_BATCH", "5")),
};

assertProductionSecret("SESSION_SECRET", config.SESSION_SECRET);
assertProductionSecret("DRAFT_CONTENT_SECRET", config.DRAFT_CONTENT_SECRET);
assertProductionSecret("HOOK_SECRET", config.HOOK_SECRET);
assertProductionSecret("GITHUB_TOKEN_SECRET", config.GITHUB_TOKEN_SECRET);

if (
  isProduction() &&
  config.ALLOW_INSECURE_APP_URL !== "true" &&
  !config.APP_URL.startsWith("https://")
) {
  throw new Error("APP_URL must use https:// in production");
}
