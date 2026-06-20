import { Hono } from "hono";
import { buildSetupStatus, normalizeDeploymentName } from "../lib/deployment.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireSysadmin } from "../middleware/requireSysadmin.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

app.get("/branding", (c) =>
  c.json({ data: { deploymentName: normalizeDeploymentName(process.env.DEPLOYMENT_NAME) } })
);

app.get("/status", requireAuth, requireSysadmin, (c) =>
  c.json({ data: buildSetupStatus(process.env) })
);

export default app;
