import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { generateId } from "../lib/crypto.js";
import { config } from "../lib/config.js";
import { createBareRepo } from "../git/repoManager.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

app.use("*", requireAuth);

/**
 * POST / — Create team.
 * Creates team, adds creator as owner member, creates a bare repo for the team.
 */
app.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const { name, slug } = body;

  if (!name || typeof name !== "string" || name.length > 100) {
    return c.json({ error: "Invalid team name" }, 400);
  }
  if (!slug || typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug) || slug.length > 50) {
    return c.json({ error: "Invalid slug" }, 400);
  }

  // Check slug uniqueness
  const existing = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.slug, slug))
    .get();

  if (existing) {
    return c.json({ error: "Team slug already taken" }, 409);
  }

  const teamId = generateId();
  const memberId = generateId();
  const repoId = generateId();
  const diskPath = `${config.DATA_DIR}/repos/teams/${slug}.git`;

  // Create the team
  await db.insert(schema.teams).values({
    id: teamId,
    name,
    slug,
    ownerId: userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).run();

  // Add creator as owner member
  await db.insert(schema.teamMembers).values({
    id: memberId,
    teamId,
    userId,
    role: "owner",
    joinedAt: new Date().toISOString(),
  }).run();

  // Create repo DB record
  await db.insert(schema.repos).values({
    id: repoId,
    ownerType: "team",
    ownerTeamId: teamId,
    diskPath,
    createdAt: new Date().toISOString(),
  }).run();

  // Init bare repo on disk
  await createBareRepo(diskPath);

  const team = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.id, teamId))
    .get();

  return c.json({ data: team }, 201);
});

/**
 * GET / — List teams current user belongs to.
 */
app.get("/", async (c) => {
  const userId = c.get("userId");

  const memberships = await db
    .select({
      team: schema.teams,
      role: schema.teamMembers.role,
    })
    .from(schema.teamMembers)
    .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
    .where(eq(schema.teamMembers.userId, userId))
    .all();

  return c.json({
    data: memberships.map((m) => ({
      ...m.team,
      role: m.role,
    })),
  });
});

/**
 * GET /:teamId — Get team details. Requires auth + must be a member.
 */
app.get("/:teamId", async (c) => {
  const userId = c.get("userId");
  const teamId = c.req.param("teamId");

  const membership = await db
    .select()
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, userId)
      )
    )
    .get();

  if (!membership) {
    return c.json({ error: "Not a team member" }, 403);
  }

  const team = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.id, teamId))
    .get();

  if (!team) {
    return c.json({ error: "Team not found" }, 404);
  }

  return c.json({ data: team });
});

/**
 * PATCH /:teamId — Update team name. Requires auth + owner/admin.
 */
app.patch("/:teamId", async (c) => {
  const userId = c.get("userId");
  const teamId = c.req.param("teamId");

  const membership = await db
    .select()
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, userId)
      )
    )
    .get();

  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    return c.json({ error: "Only owners and admins can update the team" }, 403);
  }

  const body = await c.req.json();
  const { name } = body;

  if (!name || typeof name !== "string" || name.length > 100) {
    return c.json({ error: "Invalid team name" }, 400);
  }

  await db
    .update(schema.teams)
    .set({ name, updatedAt: new Date().toISOString() })
    .where(eq(schema.teams.id, teamId))
    .run();

  const team = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.id, teamId))
    .get();

  return c.json({ data: team });
});

/**
 * DELETE /:teamId — Delete team. Requires auth + owner only.
 */
app.delete("/:teamId", async (c) => {
  const userId = c.get("userId");
  const teamId = c.req.param("teamId");

  const membership = await db
    .select()
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, userId)
      )
    )
    .get();

  if (!membership || membership.role !== "owner") {
    return c.json({ error: "Only the owner can delete the team" }, 403);
  }

  await db.delete(schema.teams).where(eq(schema.teams.id, teamId)).run();

  return c.json({ data: { deleted: true } });
});

/**
 * GET /:teamId/members — List members with roles. Requires auth + member.
 */
app.get("/:teamId/members", async (c) => {
  const userId = c.get("userId");
  const teamId = c.req.param("teamId");

  const membership = await db
    .select()
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, userId)
      )
    )
    .get();

  if (!membership) {
    return c.json({ error: "Not a team member" }, 403);
  }

  const members = await db
    .select({
      id: schema.teamMembers.id,
      teamId: schema.teamMembers.teamId,
      userId: schema.teamMembers.userId,
      role: schema.teamMembers.role,
      joinedAt: schema.teamMembers.joinedAt,
      email: schema.users.email,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.teamMembers)
    .innerJoin(schema.users, eq(schema.teamMembers.userId, schema.users.id))
    .where(eq(schema.teamMembers.teamId, teamId))
    .all();

  return c.json({
    data: members.map((m) => ({
      id: m.id,
      teamId: m.teamId,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      user: {
        email: m.email,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
      },
    })),
  });
});

/**
 * POST /:teamId/members — Invite member by email.
 * Requires auth + admin/owner. If user exists, add immediately.
 * If not, still create the record with the email.
 */
app.post("/:teamId/members", async (c) => {
  const userId = c.get("userId");
  const teamId = c.req.param("teamId");

  const membership = await db
    .select()
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, userId)
      )
    )
    .get();

  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    return c.json({ error: "Only owners and admins can invite members" }, 403);
  }

  const body = await c.req.json();
  const { email, role } = body;

  if (!email || typeof email !== "string") {
    return c.json({ error: "Email is required" }, 400);
  }

  const validRoles = ["owner", "admin", "member", "viewer"];
  const memberRole = validRoles.includes(role) ? role : "member";

  // Only owners can invite other owners
  if (memberRole === "owner" && membership.role !== "owner") {
    return c.json({ error: "Only owners can assign the owner role" }, 403);
  }

  // Find the user by email
  const targetUser = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .get();

  if (targetUser) {
    // Check if already a member
    const existingMember = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, targetUser.id)
        )
      )
      .get();

    if (existingMember) {
      return c.json({ error: "User is already a member of this team" }, 409);
    }

    const memberId = generateId();
    await db.insert(schema.teamMembers).values({
      id: memberId,
      teamId,
      userId: targetUser.id,
      role: memberRole,
      joinedAt: new Date().toISOString(),
    }).run();

    return c.json({
      data: {
        id: memberId,
        teamId,
        userId: targetUser.id,
        role: memberRole,
        user: {
          email: targetUser.email,
          displayName: targetUser.displayName,
          avatarUrl: targetUser.avatarUrl,
        },
      },
    }, 201);
  }

  // User does not exist yet — create a placeholder team member record.
  // We store a sentinel userId derived from the email so the record can be
  // linked later when the user signs up. The unique index on (teamId, userId)
  // prevents duplicate invites for the same email.
  const placeholderId = generateId();
  const placeholderUserId = `pending:${email}`;

  // Check for existing pending invite
  const existingPending = await db
    .select()
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, placeholderUserId)
      )
    )
    .get();

  if (existingPending) {
    return c.json({ error: "Invite already sent to this email" }, 409);
  }

  await db.insert(schema.teamMembers).values({
    id: placeholderId,
    teamId,
    userId: placeholderUserId,
    role: memberRole,
    joinedAt: new Date().toISOString(),
  }).run();

  return c.json({
    data: {
      id: placeholderId,
      teamId,
      userId: null,
      email,
      role: memberRole,
      pending: true,
    },
  }, 201);
});

/**
 * PATCH /:teamId/members/:userId — Change member role. Requires auth + owner.
 */
app.patch("/:teamId/members/:userId", async (c) => {
  const currentUserId = c.get("userId");
  const teamId = c.req.param("teamId");
  const targetUserId = c.req.param("userId");

  const callerMembership = await db
    .select()
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, currentUserId)
      )
    )
    .get();

  if (!callerMembership || callerMembership.role !== "owner") {
    return c.json({ error: "Only owners can change member roles" }, 403);
  }

  const body = await c.req.json();
  const { role } = body;

  const validRoles = ["owner", "admin", "member", "viewer"];
  if (!role || !validRoles.includes(role)) {
    return c.json({ error: "Invalid role" }, 400);
  }

  const targetMember = await db
    .select()
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, targetUserId)
      )
    )
    .get();

  if (!targetMember) {
    return c.json({ error: "Member not found" }, 404);
  }

  await db
    .update(schema.teamMembers)
    .set({ role })
    .where(eq(schema.teamMembers.id, targetMember.id))
    .run();

  return c.json({
    data: {
      ...targetMember,
      role,
    },
  });
});

/**
 * DELETE /:teamId/members/:userId — Remove member.
 * Requires auth + admin/owner, or self-leave.
 */
app.delete("/:teamId/members/:userId", async (c) => {
  const currentUserId = c.get("userId");
  const teamId = c.req.param("teamId");
  const targetUserId = c.req.param("userId");

  const isSelf = currentUserId === targetUserId;

  if (!isSelf) {
    const callerMembership = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, currentUserId)
        )
      )
      .get();

    if (!callerMembership || (callerMembership.role !== "owner" && callerMembership.role !== "admin")) {
      return c.json({ error: "Only owners and admins can remove members" }, 403);
    }
  }

  const targetMember = await db
    .select()
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, teamId),
        eq(schema.teamMembers.userId, targetUserId)
      )
    )
    .get();

  if (!targetMember) {
    return c.json({ error: "Member not found" }, 404);
  }

  // Prevent removing the last owner
  if (targetMember.role === "owner") {
    const ownerCount = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.role, "owner")
        )
      )
      .all();

    if (ownerCount.length <= 1) {
      return c.json({ error: "Cannot remove the last owner" }, 400);
    }
  }

  await db
    .delete(schema.teamMembers)
    .where(eq(schema.teamMembers.id, targetMember.id))
    .run();

  return c.json({ data: { removed: true } });
});

export default app;
