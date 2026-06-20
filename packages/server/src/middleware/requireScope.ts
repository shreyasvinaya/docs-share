import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { AppEnv } from "../lib/types.js";

export function requireScope(requiredScope: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.get("authMethod") !== "api_token") return next();

    const tokenId = c.get("tokenId");
    if (!tokenId) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const token = await db
      .select({ scopes: schema.apiTokens.scopes })
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.id, tokenId))
      .get();

    if (!token || !hasScope(token.scopes, requiredScope)) {
      return c.json({ error: "Token scope does not allow this action" }, 403);
    }

    return next();
  });
}

/**
 * Method-aware variant of {@link requireScope}: enforces `<resource>:read` on
 * safe (GET/HEAD) requests and `<resource>:write` on mutating
 * (POST/PUT/PATCH/DELETE) requests. This lets a whole router gate every route
 * with one middleware while still distinguishing read from write least-privilege
 * (mirrors the per-route `requireScope("draft:read"|"draft:write")` style used in
 * drafts.ts/webhooks.ts). Session-authenticated requests are unaffected because
 * `requireScope` only enforces scopes for `authMethod === "api_token"`.
 */
export function requireScopeByMethod(resource: string) {
  const read = requireScope(`${resource}:read`);
  const write = requireScope(`${resource}:write`);
  return createMiddleware<AppEnv>((c, next) => {
    const method = c.req.method.toUpperCase();
    const isRead = method === "GET" || method === "HEAD";
    return (isRead ? read : write)(c, next);
  });
}

export function hasScope(scopes: string, requiredScope: string): boolean {
  const parsedScopes = scopes
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const [resource] = requiredScope.split(":");

  return (
    parsedScopes.includes("*") ||
    parsedScopes.includes(requiredScope) ||
    parsedScopes.includes(`${resource}:*`)
  );
}
