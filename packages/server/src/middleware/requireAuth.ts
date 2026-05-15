import { createMiddleware } from "hono/factory";
import { eq, and, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashToken } from "../lib/crypto.js";
import type { AppEnv } from "../lib/types.js";

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("userId")) return next();

  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const tokenHash = hashToken(token);
    const apiToken = await db
      .select()
      .from(schema.apiTokens)
      .where(
        and(
          eq(schema.apiTokens.tokenHash, tokenHash),
          isNull(schema.apiTokens.revokedAt)
        )
      )
      .get();

    if (
      apiToken &&
      (!apiToken.expiresAt || new Date(apiToken.expiresAt) > new Date())
    ) {
      c.set("userId", apiToken.userId);
      c.set("authMethod", "api_token");
      c.set("tokenId", apiToken.id);

      db.update(schema.apiTokens)
        .set({ lastUsedAt: new Date().toISOString() })
        .where(eq(schema.apiTokens.id, apiToken.id))
        .run();

      return next();
    }
  }

  return c.json({ error: "Authentication required" }, 401);
});
