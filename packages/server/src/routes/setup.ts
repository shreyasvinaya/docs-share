import { Hono } from "hono";
import { buildSetupStatus } from "../lib/deployment.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

app.get("/status", (c) => {
  return c.json({ data: buildSetupStatus(process.env) });
});

export default app;
