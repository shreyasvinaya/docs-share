import { Command } from "commander";
import { loadConfig, saveConfig, getApiUrl } from "../lib/config.js";
import { ApiClient } from "../lib/api-client.js";
import { output, success, error } from "../lib/output.js";
import { CliError, EXIT_CODES } from "../lib/errors.js";
import type { AuthResponse } from "@patra/shared";

export const loginCommand = new Command("login")
  .description("Authenticate with the Patra server")
  .option("--token <token>", "API token for authentication")
  .option("--status", "Check current authentication status")
  .action(async (opts: { token?: string; status?: boolean }) => {
    if (opts.status) {
      await checkStatus();
      return;
    }

    if (!opts.token) {
      throw new CliError(
        "Token is required. Usage: patra login --token <TOKEN>",
        EXIT_CODES.VALIDATION_ERROR
      );
    }

    await authenticate(opts.token);
  });

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
    error("Not authenticated. Run `patra login --token <TOKEN>` to log in.");
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
    error("Token is invalid or expired. Run `patra login --token <TOKEN>` to re-authenticate.");
    output({ authenticated: false });
    process.exitCode = EXIT_CODES.AUTH_ERROR;
  }
}
