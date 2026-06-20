import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { AuthError } from "./errors.js";

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

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    // The config file holds the API token, so keep the directory owner-only.
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  } else {
    // Tighten an existing dir that may predate this restriction.
    chmodSync(CONFIG_DIR, 0o700);
  }
}

export function loadConfig(): CliConfig {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as CliConfig;
  } catch {
    return { apiUrl: DEFAULT_API_URL };
  }
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
  const envToken = process.env.DOCS_SHARE_TOKEN;
  if (envToken) return envToken;

  const config = loadConfig();
  if (config.auth?.token) return config.auth.token;

  throw new AuthError();
}

export function getApiUrl(overrideUrl?: string): string {
  if (overrideUrl) return overrideUrl;

  const envUrl = process.env.DOCS_SHARE_API_URL;
  if (envUrl) return envUrl;

  const config = loadConfig();
  return config.apiUrl || DEFAULT_API_URL;
}
