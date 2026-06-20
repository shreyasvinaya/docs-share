import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { logger } from "hono/logger";
import { existsSync, statSync } from "fs";
import { sessionMiddleware } from "./middleware/session.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import teamRoutes from "./routes/teams.js";
import projectRoutes from "./routes/projects.js";
import repoRoutes from "./routes/repos.js";
import fileRoutes from "./routes/files.js";
import draftRoutes, { renderDraftPage, serveDraftContent } from "./routes/drafts.js";
import shareRoutes from "./routes/shares.js";
import auditRoutes from "./routes/audit.js";
import internalRoutes from "./routes/internal.js";
import viewRoutes from "./routes/view.js";
import gitRoutes from "./git/smartHttp.js";
import { ensureRepoDir } from "./git/repoManager.js";
import { config } from "./lib/config.js";
import { resolveInside } from "./lib/security.js";
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
app.route("/api/repos", repoRoutes);
app.route("/api/files", fileRoutes);
app.route("/api/drafts", draftRoutes);
app.route("/api/shares", shareRoutes);
app.route("/api/audit", auditRoutes);

app.route("/git", gitRoutes);
app.route("/internal", internalRoutes);
app.route("/view", viewRoutes);

app.get("/d/:draftId", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  return renderDraftPage(c.req.param("draftId"), userId, c.req.raw);
});

app.get("/draft-content/:draftId", (c) =>
  serveDraftContent(
    c.req.param("draftId"),
    c.req.query("exp"),
    c.req.query("sig")
  )
);

app.get("/health", (c) => c.json({ ok: true }));

function staticContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    css: "text/css; charset=utf-8",
    gif: "image/gif",
    html: "text/html; charset=utf-8",
    ico: "image/x-icon",
    js: "application/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    txt: "text/plain; charset=utf-8",
    webp: "image/webp",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  return ext ? types[ext] ?? "application/octet-stream" : "application/octet-stream";
}

if (config.WEB_DIST_DIR) {
  app.get("*", (c) => {
    let requestPath: string;
    try {
      requestPath = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.json({ error: "Invalid path" }, 400);
    }

    const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
    const assetPath = resolveInside(config.WEB_DIST_DIR, relativePath);
    const fallbackPath = resolveInside(config.WEB_DIST_DIR, "index.html");
    const targetPath =
      assetPath && existsSync(assetPath) && statSync(assetPath).isFile()
        ? assetPath
        : fallbackPath;

    if (!targetPath || !existsSync(targetPath)) {
      return c.json({ error: "Web app not built" }, 404);
    }

    return new Response(Bun.file(targetPath), {
      headers: {
        "Content-Type": staticContentType(targetPath),
        "Cache-Control": targetPath.endsWith("index.html")
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      },
    });
  });
}

await ensureRepoDir();

export default {
  port: config.PORT,
  hostname: config.HOST,
  fetch: app.fetch,
};

console.log(`docs-share server running on ${config.HOST}:${config.PORT}`);
