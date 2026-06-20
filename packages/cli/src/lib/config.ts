import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { AuthError, CliError, ValidationError, EXIT_CODES } from "./errors.js";

export interface CliConfig {
  apiUrl: string;
  auth?: {
    token: string;
    email: string;
  };
}

const CONFIG_DIR = join(homedir(), ".docs-share");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const DEFAULT_API_URL = "http://localhost:3000";

/** A human-friendly path label for the config file, used in error messages. */
const CONFIG_FILE_LABEL = "~/.docs-share/config.json";

// Default request/upload limits. All are overridable via env (PATRA_* preferred,
// DOCS_SHARE_* as a backwards-compatible fallback).
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
const DEFAULT_MAX_UPLOAD_FILES = 2000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 500;

/**
 * Read an env var preferring the PATRA_ name, falling back to the legacy
 * DOCS_SHARE_ name. Centralizes the dual-naming so callers stay simple.
 */
export function readEnv(suffix: string): string | undefined {
  const patra = process.env[`PATRA_${suffix}`];
  if (patra !== undefined && patra !== "") return patra;
  const legacy = process.env[`DOCS_SHARE_${suffix}`];
  if (legacy !== undefined && legacy !== "") return legacy;
  return undefined;
}

/**
 * Read a positive-integer env var (PATRA_/DOCS_SHARE_), validating that the
 * value parses. Returns the fallback when unset; throws on garbage so a typo'd
 * limit fails loudly instead of being silently ignored.
 */
function readPositiveIntEnv(suffix: string, fallback: number): number {
  const raw = readEnv(suffix);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(
      `Invalid value for ${suffix}: "${raw}" (expected a positive integer).`
    );
  }
  return value;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    // The config file holds the API token, so keep the directory owner-only.
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  } else {
    // Tighten an existing dir that may predate this restriction.
    chmodSync(CONFIG_DIR, 0o700);
  }
}

/** Minimal structural validation of a loaded config object. */
function validateConfigShape(value: unknown): CliConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CliError(
      `${CONFIG_FILE_LABEL} is corrupt or unreadable: expected a JSON object; fix or delete it.`,
      EXIT_CODES.VALIDATION_ERROR
    );
  }
  const obj = value as Record<string, unknown>;

  if (obj.apiUrl !== undefined && typeof obj.apiUrl !== "string") {
    throw new CliError(
      `${CONFIG_FILE_LABEL} is corrupt or unreadable: "apiUrl" must be a string; fix or delete it.`,
      EXIT_CODES.VALIDATION_ERROR
    );
  }

  if (obj.auth !== undefined) {
    const auth = obj.auth;
    if (typeof auth !== "object" || auth === null || Array.isArray(auth)) {
      throw new CliError(
        `${CONFIG_FILE_LABEL} is corrupt or unreadable: "auth" must be an object; fix or delete it.`,
        EXIT_CODES.VALIDATION_ERROR
      );
    }
    const a = auth as Record<string, unknown>;
    if (typeof a.token !== "string" || typeof a.email !== "string") {
      throw new CliError(
        `${CONFIG_FILE_LABEL} is corrupt or unreadable: "auth" must contain string "token" and "email"; fix or delete it.`,
        EXIT_CODES.VALIDATION_ERROR
      );
    }
  }

  return {
    apiUrl: typeof obj.apiUrl === "string" ? obj.apiUrl : DEFAULT_API_URL,
    auth: obj.auth as CliConfig["auth"],
  };
}

export function loadConfig(): CliConfig {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_FILE, "utf-8");
  } catch (err) {
    // A missing config file simply means "not configured yet" — fall back to
    // defaults. Any other read failure (permissions, I/O) must surface loudly
    // rather than silently logging the user out.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { apiUrl: DEFAULT_API_URL };
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new CliError(
      `${CONFIG_FILE_LABEL} is corrupt or unreadable: ${reason}; fix or delete it.`,
      EXIT_CODES.VALIDATION_ERROR
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new CliError(
      `${CONFIG_FILE_LABEL} is corrupt or unreadable: ${reason}; fix or delete it.`,
      EXIT_CODES.VALIDATION_ERROR
    );
  }

  return validateConfigShape(parsed);
}

export function saveConfig(config: CliConfig): void {
  ensureConfigDir();
  // The token must never be world-readable: write owner-only (0600).
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
  // writeFileSync only applies mode when creating the file; enforce it on an
  // already-existing config too.
  chmodSync(CONFIG_FILE, 0o600);
}

export function getToken(): string {
  const envToken = readEnv("TOKEN");
  if (envToken) return envToken;

  const config = loadConfig();
  if (config.auth?.token) return config.auth.token;

  throw new AuthError();
}

/**
 * Validate that a string is a usable http(s) API base URL. Throws a clear
 * ValidationError otherwise so garbage never reaches fetch().
 */
export function validateApiUrl(value: string, source = "API URL"): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ValidationError(
      `Invalid ${source}: "${value}" is not a valid URL.`
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError(
      `Invalid ${source}: "${value}" must use http:// or https:// (got "${parsed.protocol}").`
    );
  }
  return value;
}

export function getApiUrl(overrideUrl?: string): string {
  if (overrideUrl) return validateApiUrl(overrideUrl, "--api-url");

  const envUrl = readEnv("API_URL");
  if (envUrl) return validateApiUrl(envUrl, "PATRA_API_URL/DOCS_SHARE_API_URL");

  const config = loadConfig();
  const url = config.apiUrl || DEFAULT_API_URL;
  return validateApiUrl(url, `${CONFIG_FILE_LABEL} apiUrl`);
}

/** Resolve the per-request timeout (ms). */
export function getTimeoutMs(): number {
  return readPositiveIntEnv("TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
}

/** Resolve the upload-request timeout (ms). */
export function getUploadTimeoutMs(): number {
  return readPositiveIntEnv("UPLOAD_TIMEOUT_MS", DEFAULT_UPLOAD_TIMEOUT_MS);
}

/** Resolve the max total upload size (bytes) for `push`. */
export function getMaxUploadBytes(): number {
  return readPositiveIntEnv("MAX_UPLOAD_BYTES", DEFAULT_MAX_UPLOAD_BYTES);
}

/** Resolve the max file count for `push`. */
export function getMaxUploadFiles(): number {
  return readPositiveIntEnv("MAX_UPLOAD_FILES", DEFAULT_MAX_UPLOAD_FILES);
}

/** Resolve the max number of attempts for idempotent requests. */
export function getMaxRetries(): number {
  return readPositiveIntEnv("MAX_RETRIES", DEFAULT_MAX_RETRIES);
}

/** Resolve the base backoff delay (ms) for retries. */
export function getRetryBaseMs(): number {
  return readPositiveIntEnv("RETRY_BASE_MS", DEFAULT_RETRY_BASE_MS);
}
