import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { logger } from "hono/logger";
import { sessionMiddleware } from "./middleware/session.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import teamRoutes from "./routes/teams.js";
import projectRoutes from "./routes/projects.js";
import fileRoutes from "./routes/files.js";
import shareRoutes from "./routes/shares.js";
import internalRoutes from "./routes/internal.js";
import viewRoutes from "./routes/view.js";
import gitRoutes from "./git/smartHttp.js";
import { ensureRepoDir } from "./git/repoManager.js";
import { config } from "./lib/config.js";
import type { AppEnv } from "./lib/types.js";

const app = new Hono<AppEnv>();

app.use("*", logger());
app.use("*", secureHeaders());
app.use(
  "/api/*",
  cors({ origin: config.APP_URL, credentials: true })
);
app.use("*", sessionMiddleware);

app.route("/api/auth", authRoutes);
app.route("/api/users", userRoutes);
app.route("/api/teams", teamRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/files", fileRoutes);
app.route("/api/shares", shareRoutes);

app.route("/git", gitRoutes);
app.route("/internal", internalRoutes);
app.route("/view", viewRoutes);

app.get("/health", (c) => c.json({ ok: true }));

await ensureRepoDir();

export default {
  port: config.PORT,
  hostname: config.HOST,
  fetch: app.fetch,
};

console.log(`docs-share server running on ${config.HOST}:${config.PORT}`);
