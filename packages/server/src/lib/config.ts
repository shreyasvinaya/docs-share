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
};

assertProductionSecret("SESSION_SECRET", config.SESSION_SECRET);
assertProductionSecret("DRAFT_CONTENT_SECRET", config.DRAFT_CONTENT_SECRET);
assertProductionSecret("HOOK_SECRET", config.HOOK_SECRET);

if (
  isProduction() &&
  config.ALLOW_INSECURE_APP_URL !== "true" &&
  !config.APP_URL.startsWith("https://")
) {
  throw new Error("APP_URL must use https:// in production");
}
