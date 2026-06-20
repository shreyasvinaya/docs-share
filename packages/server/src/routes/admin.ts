import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { normalizeDeploymentName } from "../lib/deployment.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireSysadmin } from "../middleware/requireSysadmin.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

// Every admin endpoint is gated behind an authenticated sysadmin.
app.use("*", requireAuth, requireSysadmin);

/**
 * GET /users — List all users with non-sensitive fields only.
 */
app.get("/users", async (c) => {
  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .all();

  return c.json({ data: { users } });
});

/**
 * PATCH /users/:userId — Update a user's deployment role.
 *
 * Note: when SYSADMIN_EMAILS lists a user's email, that env var is the source
 * of truth and requireSysadmin will re-derive the role on the next privileged
 * request. This endpoint is the manual override for emails not pinned in env.
 */
app.patch("/users/:userId", async (c) => {
  const userId = c.req.param("userId");
  const body = (await c.req.json().catch(() => ({}))) as { role?: unknown };
  const { role } = body;

  if (role !== "user" && role !== "sysadmin") {
    return c.json({ error: "Invalid role" }, 400);
  }

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!existing) {
    return c.json({ error: "User not found" }, 404);
  }

  await db
    .update(schema.users)
    .set({ role, updatedAt: new Date().toISOString() })
    .where(eq(schema.users.id, userId))
    .run();

  const user = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  return c.json({ data: { user } });
});

/**
 * GET /branding — Read deployment branding (sysadmin view).
 */
app.get("/branding", (c) =>
  c.json({
    data: { deploymentName: normalizeDeploymentName(process.env.DEPLOYMENT_NAME) },
  })
);

export default app;
