import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireScopeByMethod } from "../middleware/requireScope.js";
import { generateId } from "../lib/crypto.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

app.use("*", requireAuth);
// API-token least-privilege: GET/HEAD require `project:read`; mutations
// (POST/PATCH/DELETE) require `project:write`. Session auth is unaffected.
app.use("*", requireScopeByMethod("project"));

/**
 * POST / — Create project (metadata for a subfolder).
 */
app.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const { name, slug, description, ownerType, ownerTeamId, ownerUserId } = body;

  if (!name || typeof name !== "string" || name.length > 100) {
    return c.json({ error: "Invalid project name" }, 400);
  }
  if (!slug || typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug) || slug.length > 50) {
    return c.json({ error: "Invalid slug" }, 400);
  }
  if (!ownerType || !["user", "team"].includes(ownerType)) {
    return c.json({ error: "ownerType must be 'user' or 'team'" }, 400);
  }

  // Verify ownership / membership
  if (ownerType === "team") {
    if (!ownerTeamId) {
      return c.json({ error: "ownerTeamId is required for team projects" }, 400);
    }
    const membership = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, ownerTeamId),
          eq(schema.teamMembers.userId, userId)
        )
      )
      .get();

    if (!membership) {
      return c.json({ error: "You must be a team member to create a project" }, 403);
    }
  }

  const projectId = generateId();
  const resolvedOwnerUserId = ownerType === "user" ? (ownerUserId || userId) : null;
  const resolvedOwnerTeamId = ownerType === "team" ? ownerTeamId : null;

  // Check slug uniqueness within the owner scope
  if (ownerType === "user" && resolvedOwnerUserId) {
    const existing = await db
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.ownerUserId, resolvedOwnerUserId),
          eq(schema.projects.slug, slug)
        )
      )
      .get();
    if (existing) {
      return c.json({ error: "Project slug already exists for this user" }, 409);
    }
  } else if (ownerType === "team" && resolvedOwnerTeamId) {
    const existing = await db
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.ownerTeamId, resolvedOwnerTeamId),
          eq(schema.projects.slug, slug)
        )
      )
      .get();
    if (existing) {
      return c.json({ error: "Project slug already exists for this team" }, 409);
    }
  }

  await db.insert(schema.projects).values({
    id: projectId,
    ownerType,
    ownerUserId: resolvedOwnerUserId,
    ownerTeamId: resolvedOwnerTeamId,
    name,
    slug,
    description: description || null,
    createdById: userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).run();

  const project = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();

  return c.json({ data: project }, 201);
});

/**
 * GET / — List projects. Query: ownerType, ownerId.
 */
app.get("/", async (c) => {
  const ownerType = c.req.query("ownerType");
  const ownerId = c.req.query("ownerId");
  const userId = c.get("userId");

  let projects;

  if (ownerType === "team" && ownerId) {
    // Verify user is a team member
    const membership = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, ownerId),
          eq(schema.teamMembers.userId, userId)
        )
      )
      .get();

    if (!membership) {
      return c.json({ error: "Not a team member" }, 403);
    }

    projects = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.ownerTeamId, ownerId))
      .all();
  } else if (ownerType === "user" && ownerId) {
    // Users can only list their own projects
    if (ownerId !== userId) {
      return c.json({ error: "Cannot list another user's projects" }, 403);
    }
    projects = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.ownerUserId, ownerId))
      .all();
  } else {
    // Default: list projects created by the current user
    projects = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.createdById, userId))
      .all();
  }

  return c.json({ data: projects });
});

/**
 * GET /:projectId — Get project details.
 */
app.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");

  const project = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  return c.json({ data: project });
});

/**
 * PATCH /:projectId — Update project name/description.
 * Requires auth + owner or team admin.
 */
app.patch("/:projectId", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");

  const project = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  // Check permission
  let hasPermission = false;

  if (project.ownerType === "user" && project.ownerUserId === userId) {
    hasPermission = true;
  } else if (project.ownerType === "team" && project.ownerTeamId) {
    const membership = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, project.ownerTeamId),
          eq(schema.teamMembers.userId, userId)
        )
      )
      .get();

    if (membership && (membership.role === "owner" || membership.role === "admin")) {
      hasPermission = true;
    }
  }

  if (!hasPermission) {
    return c.json({ error: "Permission denied" }, 403);
  }

  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.length > 100 || body.name.length === 0) {
      return c.json({ error: "Invalid name" }, 400);
    }
    updates.name = body.name;
  }

  if (body.description !== undefined) {
    if (body.description !== null && (typeof body.description !== "string" || body.description.length > 500)) {
      return c.json({ error: "Invalid description" }, 400);
    }
    updates.description = body.description;
  }

  await db
    .update(schema.projects)
    .set(updates)
    .where(eq(schema.projects.id, projectId))
    .run();

  const updated = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();

  return c.json({ data: updated });
});

/**
 * DELETE /:projectId — Delete project metadata (doesn't delete files from repo).
 * Requires auth + owner.
 */
app.delete("/:projectId", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");

  const project = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  // Check ownership
  let isOwner = false;

  if (project.ownerType === "user" && project.ownerUserId === userId) {
    isOwner = true;
  } else if (project.ownerType === "team" && project.ownerTeamId) {
    const membership = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, project.ownerTeamId),
          eq(schema.teamMembers.userId, userId)
        )
      )
      .get();

    if (membership && membership.role === "owner") {
      isOwner = true;
    }
  }

  if (!isOwner) {
    return c.json({ error: "Only the owner can delete a project" }, 403);
  }

  await db.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();

  return c.json({ data: { deleted: true } });
});

export default app;
