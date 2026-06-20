import { Hono } from "hono";
import { db, schema } from "../db/index.js";
import { normalizeDeploymentName } from "../lib/deployment.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireSysadmin } from "../middleware/requireSysadmin.js";
import { requireScopeByMethod } from "../middleware/requireScope.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

// Every admin endpoint is gated behind an authenticated sysadmin. On top of
// that, an API token must also carry the `admin` scope (GET -> `admin:read`,
// mutations -> `admin:write`) so a narrowly-scoped token can never drive admin
// endpoints even when the underlying user happens to be a sysadmin. Session
// auth is unaffected (requireScope only enforces for api_token).
app.use("*", requireAuth, requireSysadmin, requireScopeByMethod("admin"));

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

const SYSADMIN_ENV_MESSAGE =
  "The sysadmin role is managed via the SYSADMIN_EMAILS environment variable, not the API.";

/**
 * PATCH /users/:userId — Reserved; role changes are NOT performed here.
 *
 * The `sysadmin` role is authoritative-by-env: `requireSysadmin` recomputes it
 * from `SYSADMIN_EMAILS` on every privileged request (that is the intended
 * revocation model). A DB write here would be silently overwritten on the next
 * request, so granting/revoking sysadmin via the API would be dishonest. We
 * reject any such attempt and direct operators to `SYSADMIN_EMAILS` instead.
 */
app.patch("/users/:userId", async (c) => {
  const userId = c.req.param("userId");
  const body = (await c.req.json().catch(() => ({}))) as { role?: unknown };
  const { role } = body;

  if (role !== "user" && role !== "sysadmin") {
    return c.json({ error: "Invalid role" }, 400);
  }

  // Any role mutation here would race the env-derived source of truth, so the
  // endpoint refuses to pretend it can grant or revoke the sysadmin role.
  return c.json({ error: SYSADMIN_ENV_MESSAGE }, 400);
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
