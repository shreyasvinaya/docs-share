import { Command } from "commander";
import { loadConfig, saveConfig, getApiUrl, readEnv } from "../lib/config.js";
import { ApiClient } from "../lib/api-client.js";
import { output, success, error, warn } from "../lib/output.js";
import { CliError, EXIT_CODES } from "../lib/errors.js";
import type { AuthResponse } from "@patra/shared";

export const loginCommand = new Command("login")
  .description("Authenticate with the Patra server")
  .option("--token <token>", "API token (visible in process list / shell history)")
  .option("--token-stdin", "Read the API token from stdin (recommended)")
  .option("--status", "Check current authentication status")
  .action(
    async (opts: {
      token?: string;
      tokenStdin?: boolean;
      status?: boolean;
    }) => {
      if (opts.status) {
        await checkStatus();
        return;
      }

      const token = await resolveLoginToken(opts);

      if (!token) {
        throw new CliError(
          "Token is required. Provide it via --token-stdin (recommended), " +
            "the PATRA_TOKEN env var, or --token <TOKEN>.",
          EXIT_CODES.VALIDATION_ERROR
        );
      }

      await authenticate(token);
    }
  );

/**
 * Resolve the login token using the documented precedence:
 *   explicit flag/stdin > env var > (nothing — caller errors).
 *
 * --token-stdin and the PATRA_TOKEN/DOCS_SHARE_TOKEN env vars keep the secret
 * out of the process list and shell history; --token is supported for
 * convenience but warns that it is visible.
 */
async function resolveLoginToken(opts: {
  token?: string;
  tokenStdin?: boolean;
}): Promise<string | undefined> {
  if (opts.tokenStdin && opts.token) {
    throw new CliError(
      "Use either --token or --token-stdin, not both.",
      EXIT_CODES.VALIDATION_ERROR
    );
  }

  if (opts.tokenStdin) {
    const token = (await readStdin()).trim();
    if (!token) {
      throw new CliError(
        "--token-stdin was set but no token was read from stdin.",
        EXIT_CODES.VALIDATION_ERROR
      );
    }
    return token;
  }

  if (opts.token) {
    warn(
      "The --token value is visible in your process list and shell history. " +
        "Prefer --token-stdin or the PATRA_TOKEN env var."
    );
    return opts.token;
  }

  const envToken = readEnv("TOKEN");
  if (envToken) return envToken;

  return undefined;
}

/** Read all of stdin as a UTF-8 string. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise<string>((resolve, reject) => {
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf-8"))
    );
    process.stdin.on("error", reject);
  });
}

async function authenticate(token: string): Promise<void> {
  const config = loadConfig();
  const apiUrl = getApiUrl();

  // Verify the token works
  const client = new ApiClient({ apiUrl, token });
  const res = await client.get<{ user: AuthResponse["user"] }>(
    "/api/auth/session"
  );

  // Store in config
  config.apiUrl = apiUrl;
  config.auth = {
    token,
    email: res.user.email,
  };
  saveConfig(config);

  success(`Authenticated as ${res.user.displayName} (${res.user.email})`);
  output({ email: res.user.email, displayName: res.user.displayName });
}

async function checkStatus(): Promise<void> {
  const config = loadConfig();

  if (!config.auth?.token) {
    error("Not authenticated. Run `patra login --token-stdin` to log in.");
    output({ authenticated: false });
    process.exitCode = EXIT_CODES.AUTH_ERROR;
    return;
  }

  try {
    const apiUrl = getApiUrl();
    const client = new ApiClient({ apiUrl, token: config.auth.token });
    const res = await client.get<{ user: AuthResponse["user"] }>(
      "/api/auth/session"
    );

    success(`Authenticated as ${res.user.displayName} (${res.user.email})`);
    output({
      authenticated: true,
      email: res.user.email,
      displayName: res.user.displayName,
      apiUrl,
    });
  } catch {
    error(
      "Token is invalid or expired. Run `patra login --token-stdin` to re-authenticate."
    );
    output({ authenticated: false });
    process.exitCode = EXIT_CODES.AUTH_ERROR;
  }
}
