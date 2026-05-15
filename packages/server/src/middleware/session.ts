import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { eq, and, gt, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { AppEnv } from "../lib/types.js";

export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const sessionId = getCookie(c, "ds_session");
  if (!sessionId) return next();

  const session = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        gt(schema.sessions.expiresAt, sql`CURRENT_TIMESTAMP`)
      )
    )
    .get();

  if (session) {
    c.set("userId", session.userId);
    c.set("authMethod", "session");
  }
  return next();
});
