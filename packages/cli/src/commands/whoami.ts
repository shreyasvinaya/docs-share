import { Command } from "commander";
import { getClient } from "../lib/api-client.js";
import { output, success } from "../lib/output.js";
import type { AuthResponse } from "@docs-share/shared";

export const whoamiCommand = new Command("whoami")
  .description("Print current user info")
  .action(async () => {
    const client = getClient();
    const res = await client.get<{ user: AuthResponse["user"] }>(
      "/api/auth/session"
    );

    success(`${res.user.displayName} (${res.user.email})`);
    output(res.user);
  });
