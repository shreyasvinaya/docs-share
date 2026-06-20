import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { AppEnv } from "../lib/types.js";
import teamRoutes from "./teams.js";

const cleanup = {
  shareIds: [] as string[],
  inviteIds: [] as string[],
  memberIds: [] as string[],
  repoIds: [] as string[],
  teamIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.shareIds.length)
    await db.delete(schema.shares).where(inArray(schema.shares.id, cleanup.shareIds)).run();
  if (cleanup.inviteIds.length)
    await db.delete(schema.invitations).where(inArray(schema.invitations.id, cleanup.inviteIds)).run();
  if (cleanup.memberIds.length)
    await db.delete(schema.teamMembers).where(inArray(schema.teamMembers.id, cleanup.memberIds)).run();
  if (cleanup.repoIds.length)
    await db.delete(schema.repos).where(inArray(schema.repos.id, cleanup.repoIds)).run();
  if (cleanup.teamIds.length)
    await db.delete(schema.teams).where(inArray(schema.teams.id, cleanup.teamIds)).run();
  if (cleanup.userIds.length)
    await db.delete(schema.users).where(inArray(schema.users.id, cleanup.userIds)).run();
  cleanup.shareIds = [];
  cleanup.inviteIds = [];
  cleanup.memberIds = [];
  cleanup.repoIds = [];
  cleanup.teamIds = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Mount the team routes behind a middleware that authenticates as `userId`.
function appAs(userId: string) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    return next();
  });
  app.route("/api/teams", teamRoutes);
  return app;
}

async function seedTeamWithMember() {
  const ownerId = testId("owner");
  const memberId = testId("member");
  const teamId = testId("team");
  const repoId = testId("repo");
  const shareId = testId("share");
  const now = new Date().toISOString();

  await db.insert(schema.users).values([
    { id: ownerId, email: `${ownerId}@example.com`, displayName: "Owner", googleId: `g_${ownerId}` },
    { id: memberId, email: `${memberId}@example.com`, displayName: "Member", googleId: `g_${memberId}` },
  ]);
  await db.insert(schema.teams).values({
    id: teamId,
    name: "Test Team",
    slug: testId("slug"),
    ownerId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.repos).values({
    id: repoId,
    ownerType: "team",
    ownerTeamId: teamId,
    diskPath: `/tmp/${repoId}.git`,
  });
  await db.insert(schema.teamMembers).values([
    { id: testId("tm"), teamId, userId: ownerId, role: "owner", joinedAt: now },
    { id: testId("tm"), teamId, userId: memberId, role: "member", joinedAt: now },
  ]);
  // Content the member uploaded to the team repo (a share they created).
  await db.insert(schema.shares).values({
    id: shareId,
    repoId,
    path: "index.html",
    createdById: memberId,
    shareType: "public_link",
    publicToken: testId("tok"),
    linkAccess: "public",
  });

  cleanup.userIds.push(ownerId, memberId);
  cleanup.teamIds.push(teamId);
  cleanup.repoIds.push(repoId);
  cleanup.shareIds.push(shareId);
  return { ownerId, memberId, teamId, repoId, shareId };
}

describe("DELETE /api/teams/:teamId/members/:userId", () => {
  test("removes the member but keeps their account and uploaded content", async () => {
    const { ownerId, memberId, teamId, shareId } = await seedTeamWithMember();

    const res = await appAs(ownerId).request(
      `/api/teams/${teamId}/members/${memberId}`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(200);

    const membership = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, memberId)
        )
      )
      .get();
    expect(membership).toBeUndefined(); // membership removed

    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, memberId))
      .get();
    expect(user).toBeTruthy(); // account preserved

    const share = await db
      .select()
      .from(schema.shares)
      .where(eq(schema.shares.id, shareId))
      .get();
    expect(share).toBeTruthy(); // uploaded content preserved
    expect(share?.createdById).toBe(memberId);
  });

  test("rejects removal by a non-privileged member", async () => {
    const { memberId, teamId, ownerId } = await seedTeamWithMember();

    const res = await appAs(memberId).request(
      `/api/teams/${teamId}/members/${ownerId}`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(403);
  });

  test("cannot remove the last owner", async () => {
    const { ownerId, teamId } = await seedTeamWithMember();

    const res = await appAs(ownerId).request(
      `/api/teams/${teamId}/members/${ownerId}`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(400);
  });

  test("an admin cannot remove an owner", async () => {
    const { ownerId, memberId, teamId } = await seedTeamWithMember();

    // Promote the plain member to admin.
    await db
      .update(schema.teamMembers)
      .set({ role: "admin" })
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, memberId)
        )
      )
      .run();

    const res = await appAs(memberId).request(
      `/api/teams/${teamId}/members/${ownerId}`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(403);

    // The owner is still a member of the team.
    const ownerStill = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, ownerId)
        )
      )
      .get();
    expect(ownerStill?.role).toBe("owner");
  });

  test("an owner can remove another owner when more than one remains", async () => {
    const { ownerId, memberId, teamId } = await seedTeamWithMember();

    // Promote the member to a second owner.
    await db
      .update(schema.teamMembers)
      .set({ role: "owner" })
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, memberId)
        )
      )
      .run();

    const res = await appAs(ownerId).request(
      `/api/teams/${teamId}/members/${memberId}`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(200);

    const removed = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, memberId)
        )
      )
      .get();
    expect(removed).toBeUndefined();
  });

  test("an admin can remove a plain member", async () => {
    const { ownerId, memberId, teamId } = await seedTeamWithMember();

    // Add an admin and a separate plain target so the member-target stays a member.
    const adminId = testId("admin");
    await db.insert(schema.users).values({
      id: adminId,
      email: `${adminId}@example.com`,
      displayName: "Admin",
      googleId: `g_${adminId}`,
    });
    cleanup.userIds.push(adminId);
    await db.insert(schema.teamMembers).values({
      id: testId("tm"),
      teamId,
      userId: adminId,
      role: "admin",
    });

    void ownerId;
    const res = await appAs(adminId).request(
      `/api/teams/${teamId}/members/${memberId}`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(200);

    const removed = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, memberId)
        )
      )
      .get();
    expect(removed).toBeUndefined();
  });
});

describe("PATCH /api/teams/:teamId/members/:userId", () => {
  test("cannot demote the last owner to a non-owner role", async () => {
    const { ownerId, teamId } = await seedTeamWithMember();

    const res = await appAs(ownerId).request(
      `/api/teams/${teamId}/members/${ownerId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Cannot remove the last owner");

    // The role was NOT changed.
    const membership = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, ownerId)
        )
      )
      .get();
    expect(membership?.role).toBe("owner");
  });

  test("demotes an owner when another owner remains", async () => {
    const { ownerId, memberId, teamId } = await seedTeamWithMember();

    // Promote the member to owner so there are two owners.
    await db
      .update(schema.teamMembers)
      .set({ role: "owner" })
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, memberId)
        )
      )
      .run();

    const res = await appAs(ownerId).request(
      `/api/teams/${teamId}/members/${ownerId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      }
    );
    expect(res.status).toBe(200);

    const membership = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, ownerId)
        )
      )
      .get();
    expect(membership?.role).toBe("admin");
  });
});

describe("POST /api/teams/:teamId/members (invitations)", () => {
  test("creates an invitation row when the invitee has no account yet", async () => {
    const { ownerId, teamId } = await seedTeamWithMember();
    const email = `${testId("invitee")}@example.com`;

    const res = await appAs(ownerId).request(
      `/api/teams/${teamId}/members`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: "admin" }),
      }
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; pending: boolean; token: string } };
    expect(body.data.pending).toBe(true);
    expect(body.data.token).toBeTruthy();
    cleanup.inviteIds.push(body.data.id);

    const invite = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, body.data.id))
      .get();
    expect(invite?.email).toBe(email);
    expect(invite?.role).toBe("admin");
    expect(invite?.teamId).toBe(teamId);
    expect(invite?.acceptedAt).toBeNull();

    // No placeholder teamMembers row was created.
    const members = await db
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, teamId))
      .all();
    expect(members.every((m) => !m.userId.startsWith("pending:"))).toBe(true);
  });

  test("rejects a duplicate pending invite to the same email", async () => {
    const { ownerId, teamId } = await seedTeamWithMember();
    const email = `${testId("dup")}@example.com`;

    const first = await appAs(ownerId).request(`/api/teams/${teamId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const firstBody = (await first.json()) as { data: { id: string } };
    cleanup.inviteIds.push(firstBody.data.id);

    const second = await appAs(ownerId).request(`/api/teams/${teamId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    expect(second.status).toBe(409);
  });

  test("re-inviting an already-accepted email returns a clean 409, not a 500", async () => {
    const { ownerId, teamId } = await seedTeamWithMember();
    const email = `${testId("accepted")}@example.com`;

    const first = await appAs(ownerId).request(`/api/teams/${teamId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const firstBody = (await first.json()) as { data: { id: string } };
    cleanup.inviteIds.push(firstBody.data.id);

    // Simulate the invitee having accepted the invite already.
    await db
      .update(schema.invitations)
      .set({ acceptedAt: new Date().toISOString() })
      .where(eq(schema.invitations.id, firstBody.data.id))
      .run();

    const second = await appAs(ownerId).request(`/api/teams/${teamId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    // Clean 4xx (not an uncaught UNIQUE-constraint 500).
    expect(second.status).toBe(409);
    expect(second.status).not.toBe(500);
  });
});

describe("POST /api/teams/invitations/:token/accept", () => {
  test("converts an invitation into a membership for the accepting user", async () => {
    const { ownerId, teamId } = await seedTeamWithMember();
    const email = `${testId("accept")}@example.com`;

    const inviteRes = await appAs(ownerId).request(`/api/teams/${teamId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role: "member" }),
    });
    const inviteBody = (await inviteRes.json()) as { data: { id: string; token: string } };
    cleanup.inviteIds.push(inviteBody.data.id);

    // The invited person signs up later.
    const inviteeId = testId("invitee");
    await db.insert(schema.users).values({
      id: inviteeId,
      email,
      displayName: "Invitee",
      googleId: `g_${inviteeId}`,
    });
    cleanup.userIds.push(inviteeId);

    const acceptRes = await appAs(inviteeId).request(
      `/api/teams/invitations/${inviteBody.data.token}/accept`,
      { method: "POST" }
    );
    expect(acceptRes.status).toBe(200);
    const acceptBody = (await acceptRes.json()) as {
      data: { membershipId: string; alreadyMember: boolean };
    };
    expect(acceptBody.data.alreadyMember).toBe(false);
    cleanup.memberIds.push(acceptBody.data.membershipId);

    const membership = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, inviteeId)
        )
      )
      .get();
    expect(membership?.role).toBe("member");
  });

  test("returns 404 for an unknown token", async () => {
    const { ownerId } = await seedTeamWithMember();
    const res = await appAs(ownerId).request(
      `/api/teams/invitations/${testId("nope")}/accept`,
      { method: "POST" }
    );
    expect(res.status).toBe(404);
  });

  test("returns a generic 404 (not 403) on email mismatch and leaves the invite unconsumed", async () => {
    const { ownerId, teamId } = await seedTeamWithMember();
    const email = `${testId("intended")}@example.com`;

    const inviteRes = await appAs(ownerId).request(`/api/teams/${teamId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role: "member" }),
    });
    const inviteBody = (await inviteRes.json()) as { data: { id: string; token: string } };
    cleanup.inviteIds.push(inviteBody.data.id);

    // A different, authenticated user (wrong email) tries to redeem the token.
    const intruderId = testId("intruder");
    await db.insert(schema.users).values({
      id: intruderId,
      email: `${testId("intruder")}@example.com`,
      displayName: "Intruder",
      googleId: `g_${intruderId}`,
    });
    cleanup.userIds.push(intruderId);

    const acceptRes = await appAs(intruderId).request(
      `/api/teams/invitations/${inviteBody.data.token}/accept`,
      { method: "POST" }
    );
    // Mismatch is indistinguishable from an unknown token: same generic 404.
    expect(acceptRes.status).toBe(404);
    const body = (await acceptRes.json()) as { error: string };
    expect(body.error).toBe("Invitation not found");

    // No teamMembers row was created for the intruder.
    const membership = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, intruderId)
        )
      )
      .get();
    expect(membership).toBeUndefined();

    // The invitation was NOT consumed (acceptedAt remains null).
    const invite = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, inviteBody.data.id))
      .get();
    expect(invite?.acceptedAt).toBeNull();
  });

  test("rejects an unauthenticated accept with 401", async () => {
    // Mount the routes without pre-setting userId so the router's own
    // requireAuth middleware runs.
    const app = new Hono<AppEnv>();
    app.route("/api/teams", teamRoutes);

    const res = await app.request(
      `/api/teams/invitations/${testId("tok")}/accept`,
      { method: "POST" }
    );
    expect(res.status).toBe(401);
  });
});
