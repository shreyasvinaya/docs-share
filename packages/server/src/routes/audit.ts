import { Hono } from "hono";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireScope } from "../middleware/requireScope.js";
import { requireSysadmin } from "../middleware/requireSysadmin.js";
import { listAuditEntries } from "../services/analytics.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

function parseLimit(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * GET / — List audit entries performed by the current user (owner scope).
 */
app.get("/", requireAuth, requireScope("audit:read"), async (c) => {
  const userId = c.get("userId");
  const entries = await listAuditEntries({
    actorUserId: userId,
    limit: parseLimit(c.req.query("limit")),
  });
  return c.json({ data: entries });
});

/**
 * GET /all — List every audit entry across the install. Sysadmin only.
 */
app.get("/all", requireAuth, requireScope("audit:read"), requireSysadmin, async (c) => {
  const entries = await listAuditEntries({
    limit: parseLimit(c.req.query("limit")),
  });
  return c.json({ data: entries });
});

export default app;
