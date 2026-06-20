import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { deploymentRoleForEmail, parseSysadminEmails } from "../lib/deployment.js";
import type { AppEnv } from "../lib/types.js";

export const requireSysadmin = createMiddleware<AppEnv>(async (c, next) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Authentication required" }, 401);

  const user = await db
    .select({ email: schema.users.email, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!user) return c.json({ error: "Sysadmin access required" }, 403);

  // SYSADMIN_EMAILS is the source of truth; users.role is only a cache.
  // Recompute on every privileged request so that removing an email from
  // SYSADMIN_EMAILS revokes access immediately, even for callers (e.g. API
  // tokens) that never hit the /api/auth/session refresh path.
  const currentRole = deploymentRoleForEmail(
    user.email,
    parseSysadminEmails(config.SYSADMIN_EMAILS)
  );
  if (currentRole !== user.role) {
    await db
      .update(schema.users)
      .set({ role: currentRole, updatedAt: new Date().toISOString() })
      .where(eq(schema.users.id, userId))
      .run();
  }

  if (currentRole !== "sysadmin") {
    return c.json({ error: "Sysadmin access required" }, 403);
  }

  return next();
});
