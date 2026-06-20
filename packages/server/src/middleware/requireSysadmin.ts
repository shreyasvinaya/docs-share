import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { AppEnv } from "../lib/types.js";

export const requireSysadmin = createMiddleware<AppEnv>(async (c, next) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  const user = await db
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!user || user.role !== "sysadmin") {
    return c.json({ error: "Sysadmin access required" }, 403);
  }

  return next();
});
