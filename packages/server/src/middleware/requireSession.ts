import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../lib/types.js";

/**
 * Restricts a route to cookie-session callers (the human-driven web app),
 * rejecting API-token bearers with 403.
 *
 * This must run AFTER `requireAuth` (which populates `authMethod`). Use it for
 * privileged self-management actions that an automation token must never be
 * able to perform on its own behalf — most importantly minting, listing, and
 * revoking API tokens. Without it, any bearer token (even a narrow `draft:read`
 * one) could `POST /api/auth/tokens` with `scopes: "*"` and fully escalate.
 *
 * Tokens are issued and managed by a logged-in human in the settings UI; an
 * API token has no legitimate reason to manage tokens, so we fail closed.
 */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("authMethod") !== "session") {
    return c.json(
      { error: "This action requires an interactive session, not an API token" },
      403
    );
  }
  await next();
});
