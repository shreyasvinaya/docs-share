import { Hono } from "hono";
import { buildSetupStatus, normalizeDeploymentName } from "../lib/deployment.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireSysadmin } from "../middleware/requireSysadmin.js";
import { requireScope } from "../middleware/requireScope.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

// `/branding` is intentionally public (unauthenticated): the login/setup screen
// reads it before any session exists.
app.get("/branding", (c) =>
  c.json({ data: { deploymentName: normalizeDeploymentName(process.env.DEPLOYMENT_NAME) } })
);

// `/status` exposes sysadmin-only deployment diagnostics. An API token must also
// carry `admin:read`; session auth is unaffected (requireScope only gates
// api_token callers).
app.get("/status", requireAuth, requireSysadmin, requireScope("admin:read"), (c) =>
  c.json({ data: buildSetupStatus(process.env) })
);

export default app;
