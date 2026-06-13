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
      designation: user.designation,
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
 * PATCH /me — Update editable profile fields.
 */
app.patch("/me", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const { displayName, designation } = body;

  const updates: {
    displayName?: string;
    designation?: string | null;
    updatedAt: string;
  } = { updatedAt: new Date().toISOString() };

  if ("displayName" in body) {
    if (
      typeof displayName !== "string" ||
      displayName.trim().length === 0 ||
      displayName.length > 100
    ) {
      return c.json({ error: "Invalid displayName" }, 400);
    }
    updates.displayName = displayName.trim();
  }

  if ("designation" in body) {
    if (
      designation !== null &&
      designation !== undefined &&
      (typeof designation !== "string" || designation.length > 120)
    ) {
      return c.json({ error: "Invalid designation" }, 400);
    }
    updates.designation = designation?.trim() || null;
  }

  if (!updates.displayName && !("designation" in updates)) {
    return c.json({ error: "Invalid displayName" }, 400);
  }

  await db
    .update(schema.users)
    .set(updates)
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
