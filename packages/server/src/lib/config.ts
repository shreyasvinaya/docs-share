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

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

/**
 * Parse a config value that MUST resolve to a finite, strictly positive
 * integer. Bare `parseInt` happily yields `NaN` (or a negative/zero number)
 * for malformed input, and a `NaN` limit would make the rate limiter fail
 * open ("no limit"). To stay safe, any value that is not a finite positive
 * integer falls back to the documented default rather than disabling the
 * guard it controls.
 *
 * @param key - Environment variable name.
 * @param fallback - Documented default used when the value is missing or
 *   malformed. Must itself be a positive integer.
 */
export function requiredPositiveInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/**
 * Like {@link requiredPositiveInt} but permits an explicit `0` so a feature can
 * be disabled by setting its value to zero. Malformed or negative input still
 * falls back to the documented default.
 *
 * @param key - Environment variable name.
 * @param fallback - Documented default for missing/malformed input. Must be a
 *   non-negative integer.
 */
export function nonNegativeInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export const config = {
  PORT: parseInt(env("PORT", "3000")),
  HOST: env("HOST", "0.0.0.0"),

  APP_URL: env("APP_URL", "http://localhost:5173"),
  API_URL: env("API_URL", "http://localhost:3000"),

  DATA_DIR: resolve(env("DATA_DIR", "./data")),
  WEB_DIST_DIR: env("WEB_DIST_DIR", ""),
  ALLOW_INSECURE_APP_URL: env("ALLOW_INSECURE_APP_URL", "false"),

  // Rate limiting (in-memory fixed window, keyed by IP / API token). Disable
  // when a shared limiter already lives at the reverse proxy.
  RATE_LIMIT_ENABLED: env("RATE_LIMIT_ENABLED", "true") !== "false",
  RATE_LIMIT_WINDOW_MS: requiredPositiveInt("RATE_LIMIT_WINDOW_MS", 60000),
  RATE_LIMIT_PUBLIC_MAX: requiredPositiveInt("RATE_LIMIT_PUBLIC_MAX", 120),
  RATE_LIMIT_AUTH_MAX: requiredPositiveInt("RATE_LIMIT_AUTH_MAX", 20),
  // Hard cap on distinct rate-limit buckets held in memory. Prevents the
  // in-memory store from growing without bound under a high-cardinality
  // (e.g. spoofed-IP, untrusted) request mix.
  RATE_LIMIT_MAX_ENTRIES: requiredPositiveInt("RATE_LIMIT_MAX_ENTRIES", 10000),

  // Trust a reverse proxy to report the real client IP. Only enable this when
  // the app sits behind a proxy that OVERWRITES `X-Real-IP` with the real
  // socket address (e.g. nginx `proxy_set_header X-Real-IP $remote_addr;`).
  // When false, forwarded headers are ignored entirely and the limiter keys
  // on the actual socket peer address. See docs/self-hosting.md.
  TRUST_PROXY: envBool("TRUST_PROXY", false),

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
  DEPLOYMENT_NAME: env("DEPLOYMENT_NAME", "Docs Share"),
  SYSADMIN_EMAILS: env("SYSADMIN_EMAILS", ""),

  GITHUB_TOKEN_SECRET: env(
    "GITHUB_TOKEN_SECRET",
    "dev-github-token-secret-change-in-production"
  ),
  GITHUB_APP_ID: env("GITHUB_APP_ID", ""),
  GITHUB_APP_SLUG: env("GITHUB_APP_SLUG", ""),
  GITHUB_APP_PRIVATE_KEY: env("GITHUB_APP_PRIVATE_KEY", ""),
  GITHUB_APP_CLIENT_ID: env("GITHUB_APP_CLIENT_ID", ""),
  GITHUB_APP_CLIENT_SECRET: env("GITHUB_APP_CLIENT_SECRET", ""),

  EMAIL_FROM: env("EMAIL_FROM", ""),
  RESEND_API_KEY: env("RESEND_API_KEY", ""),
  SLACK_WEBHOOK_URL: env("SLACK_WEBHOOK_URL", ""),

  // Background scheduler. Set SCHEDULER_ENABLED=false to disable all jobs, or
  // set an individual interval to 0 to disable just that job.
  SCHEDULER_ENABLED: env("SCHEDULER_ENABLED", "true") !== "false",
  // Expired-share cleanup sweep interval (ms). Default: every 15 minutes.
  EXPIRED_SHARE_SWEEP_INTERVAL_MS: requiredPositiveInt(
    "EXPIRED_SHARE_SWEEP_INTERVAL_MS",
    900000
  ),
  // Maximum wall-clock time a git subprocess may run before it is killed and
  // the operation fails cleanly. Guards clone / upload-pack / receive-pack /
  // archive (and other git spawns) against hanging forever and pinning a
  // connection + worker. Default: 120s.
  GIT_PROCESS_TIMEOUT_MS: requiredPositiveInt("GIT_PROCESS_TIMEOUT_MS", 120000),

  // GitHub sync retry interval (ms). Default: every 10 minutes.
  GITHUB_SYNC_RETRY_INTERVAL_MS: requiredPositiveInt(
    "GITHUB_SYNC_RETRY_INTERVAL_MS",
    600000
  ),
  // Maximum number of failed syncs to retry per sweep.
  GITHUB_SYNC_RETRY_BATCH: requiredPositiveInt("GITHUB_SYNC_RETRY_BATCH", 5),
  // Maximum number of retry attempts before a sync is marked terminally
  // `failed` and excluded from future retry sweeps.
  GITHUB_SYNC_MAX_RETRIES: requiredPositiveInt("GITHUB_SYNC_MAX_RETRIES", 5),

  // Webhook delivery-log retention. The webhook_deliveries table is append-only
  // and otherwise grows without bound, so a scheduler job prunes it.
  // Cleanup interval (ms). Default: every 24 hours. Set to 0 to disable the job.
  WEBHOOK_CLEANUP_INTERVAL_MS: nonNegativeInt(
    "WEBHOOK_CLEANUP_INTERVAL_MS",
    86400000
  ),
  // Delete delivery rows older than this many days. Default: 30. Set to 0 to
  // disable age-based pruning (the per-hook cap still applies).
  WEBHOOK_DELIVERY_RETENTION_DAYS: nonNegativeInt(
    "WEBHOOK_DELIVERY_RETENTION_DAYS",
    30
  ),
  // Additionally keep at most this many delivery rows per webhook, even within
  // the retention window. Default: 1000. Set to 0 to disable the per-hook cap.
  WEBHOOK_DELIVERY_MAX_PER_HOOK: nonNegativeInt(
    "WEBHOOK_DELIVERY_MAX_PER_HOOK",
    1000
  ),

  // ---------------------------------------------------------------------------
  // Request body-size limits (memory-DoS guards). Each is the maximum number of
  // bytes the corresponding handler will buffer; oversized requests are rejected
  // with 413 BEFORE the body is parsed/read.
  // ---------------------------------------------------------------------------
  // General JSON / API request bodies. Default: 1 MiB.
  MAX_JSON_BODY_BYTES: requiredPositiveInt("MAX_JSON_BODY_BYTES", 1024 * 1024),
  // Public site-data form ingestion (POST /api/sites/:target/data/:collection).
  // These are tiny structured submissions, so the cap is small. Default: 256 KiB.
  MAX_SITE_DATA_BODY_BYTES: requiredPositiveInt(
    "MAX_SITE_DATA_BODY_BYTES",
    256 * 1024
  ),
  // Draft (single HTML document) upload. Default: 12 MiB.
  MAX_UPLOAD_BYTES: requiredPositiveInt("MAX_UPLOAD_BYTES", 12 * 1024 * 1024),
  // Git smart-HTTP push/fetch bodies (upload-pack / receive-pack). The handler
  // buffers the whole body into git's stdin, so cap it. Default: 100 MiB.
  GIT_MAX_BODY_BYTES: requiredPositiveInt(
    "GIT_MAX_BODY_BYTES",
    100 * 1024 * 1024
  ),

  // ---------------------------------------------------------------------------
  // GitHub import / clone disk-exhaustion guards.
  // ---------------------------------------------------------------------------
  // Skip blobs larger than this when cloning (passed to git as
  // `--filter=blob:limit=<bytes>`) so a few huge blobs cannot fill DATA_DIR.
  // Default: 50 MiB.
  GITHUB_MAX_BLOB_BYTES: requiredPositiveInt(
    "GITHUB_MAX_BLOB_BYTES",
    50 * 1024 * 1024
  ),
  // Reject an import whose GitHub-reported repo size exceeds this (in KiB, the
  // unit the GitHub API returns) before cloning. Default: 1 GiB (1048576 KiB).
  GITHUB_MAX_IMPORT_KB: requiredPositiveInt(
    "GITHUB_MAX_IMPORT_KB",
    1024 * 1024
  ),

  // ---------------------------------------------------------------------------
  // Append-only analytics/audit retention sweeps (scheduler jobs). Like the
  // webhook cleanup: interval 0 disables the job; retention 0 disables pruning.
  // ---------------------------------------------------------------------------
  // view_events retention sweep interval (ms). Default: every 24 hours.
  VIEW_EVENTS_CLEANUP_INTERVAL_MS: nonNegativeInt(
    "VIEW_EVENTS_CLEANUP_INTERVAL_MS",
    86400000
  ),
  // Delete view_events older than this many days. Default: 90. 0 disables.
  VIEW_EVENTS_RETENTION_DAYS: nonNegativeInt("VIEW_EVENTS_RETENTION_DAYS", 90),
  // audit_log retention sweep interval (ms). Default: every 24 hours.
  AUDIT_LOG_CLEANUP_INTERVAL_MS: nonNegativeInt(
    "AUDIT_LOG_CLEANUP_INTERVAL_MS",
    86400000
  ),
  // Delete audit_log rows older than this many days. Default: 365. 0 disables.
  AUDIT_LOG_RETENTION_DAYS: nonNegativeInt("AUDIT_LOG_RETENTION_DAYS", 365),
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
