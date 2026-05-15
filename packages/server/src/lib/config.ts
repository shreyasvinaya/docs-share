import { resolve } from "path";

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

export const config = {
  PORT: parseInt(env("PORT", "3000")),
  HOST: env("HOST", "0.0.0.0"),

  APP_URL: env("APP_URL", "http://localhost:5173"),
  API_URL: env("API_URL", "http://localhost:3000"),

  DATA_DIR: resolve(env("DATA_DIR", "./data")),

  GOOGLE_CLIENT_ID: env("GOOGLE_CLIENT_ID", ""),
  GOOGLE_CLIENT_SECRET: env("GOOGLE_CLIENT_SECRET", ""),
  GOOGLE_REDIRECT_URI: env(
    "GOOGLE_REDIRECT_URI",
    "http://localhost:3000/api/auth/google/callback"
  ),

  SESSION_SECRET: env("SESSION_SECRET", "dev-secret-change-in-production"),
  HOOK_SECRET: env("HOOK_SECRET", "dev-hook-secret-change-in-production"),

  CONTENT_ORIGIN: env("CONTENT_ORIGIN", "http://localhost:3000"),
};
