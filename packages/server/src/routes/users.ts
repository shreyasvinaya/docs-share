import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

app.use("*", requireAuth);

/**
 * GET /me — Return current user profile + their personal repo info.
 */
app.get("/me", async (c) => {
  const userId = c.get("userId");

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const repo = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.ownerUserId, userId))
    .get();

  return c.json({
    data: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      repo: repo
        ? {
            id: repo.id,
            diskPath: repo.diskPath,
            headSha: repo.headSha,
            sizeBytes: repo.sizeBytes,
            lastPushAt: repo.lastPushAt,
            createdAt: repo.createdAt,
          }
        : null,
    },
  });
});

/**
 * PATCH /me — Update display name.
 */
app.patch("/me", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const { displayName } = body;

  if (!displayName || typeof displayName !== "string" || displayName.length > 100) {
    return c.json({ error: "Invalid displayName" }, 400);
  }

  await db
    .update(schema.users)
    .set({ displayName, updatedAt: new Date().toISOString() })
    .where(eq(schema.users.id, userId))
    .run();

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  return c.json({ data: user });
});

export default app;
