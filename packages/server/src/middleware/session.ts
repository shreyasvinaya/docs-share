import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { eq, and, gt } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { AppEnv } from "../lib/types.js";

export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const sessionId = getCookie(c, "ds_session");
  if (!sessionId) return next();

  // `expiresAt` is stored as a full ISO-8601 string (`new Date().toISOString()`,
  // e.g. `2026-06-20T12:00:00.000Z`). SQLite's `CURRENT_TIMESTAMP` is
  // `YYYY-MM-DD HH:MM:SS` (a SPACE at index 10, no `T`/`Z`/millis), so comparing
  // the two lexically is wrong: every ISO value sorts AFTER any same-day
  // `CURRENT_TIMESTAMP` because `'T' (0x54) > ' ' (0x20)`, which kept already
  // expired same-day sessions alive for up to ~24h. Bind the current instant as
  // an ISO string instead so both sides share the same format and the lexical
  // compare matches chronological order.
  const nowIso = new Date().toISOString();

  const session = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        gt(schema.sessions.expiresAt, nowIso)
      )
    )
    .get();

  if (session) {
    c.set("userId", session.userId);
    c.set("authMethod", "session");
  }
  return next();
});
