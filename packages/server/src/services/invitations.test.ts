import { afterEach, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateId } from "../lib/crypto.js";
import {
  acceptInvitationByToken,
  acceptPendingInvitationsForUser,
} from "./invitations.js";

const cleanup = {
  inviteIds: [] as string[],
  memberIds: [] as string[],
  teamIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.inviteIds.length)
    await db.delete(schema.invitations).where(inArray(schema.invitations.id, cleanup.inviteIds)).run();
  if (cleanup.memberIds.length)
    await db.delete(schema.teamMembers).where(inArray(schema.teamMembers.id, cleanup.memberIds)).run();
  if (cleanup.teamIds.length)
    await db.delete(schema.teams).where(inArray(schema.teams.id, cleanup.teamIds)).run();
  if (cleanup.userIds.length)
    await db.delete(schema.users).where(inArray(schema.users.id, cleanup.userIds)).run();
  cleanup.inviteIds = [];
  cleanup.memberIds = [];
  cleanup.teamIds = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function seedTeamAndInvite(role: "admin" | "member" = "member") {
  const ownerId = testId("owner");
  const teamId = testId("team");
  const inviteId = testId("invite");
  const email = `${testId("invitee")}@example.com`;
  const token = testId("tok");
  const now = new Date().toISOString();

  await db.insert(schema.users).values({
    id: ownerId,
    email: `${ownerId}@example.com`,
    displayName: "Owner",
    googleId: `g_${ownerId}`,
  });
  await db.insert(schema.teams).values({
    id: teamId,
    name: "Team",
    slug: testId("slug"),
    ownerId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.teamMembers).values({
    id: testId("tm"),
    teamId,
    userId: ownerId,
    role: "owner",
    joinedAt: now,
  });
  await db.insert(schema.invitations).values({
    id: inviteId,
    email,
    teamId,
    role,
    token,
    invitedBy: ownerId,
    createdAt: now,
  });

  cleanup.userIds.push(ownerId);
  cleanup.teamIds.push(teamId);
  cleanup.inviteIds.push(inviteId);
  return { ownerId, teamId, inviteId, email, token, role };
}

async function seedUser(email: string): Promise<string> {
  const userId = testId("user");
  await db.insert(schema.users).values({
    id: userId,
    email,
    displayName: "Invitee",
    googleId: `g_${userId}`,
  });
  cleanup.userIds.push(userId);
  return userId;
}

describe("acceptInvitationByToken", () => {
  test("creates a membership with the invited role and stamps acceptedAt", async () => {
    const { token, teamId, inviteId, email } = await seedTeamAndInvite("admin");
    // The accepting user must own the invited email address.
    const userId = await seedUser(email);

    const outcome = await acceptInvitationByToken(token, userId);
    expect(outcome.status).toBe("accepted");
    if (outcome.status !== "accepted") return;
    expect(outcome.result.alreadyMember).toBe(false);
    expect(outcome.result.role).toBe("admin");
    cleanup.memberIds.push(outcome.result.membershipId);

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
    expect(membership?.role).toBe("admin");

    const invite = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, inviteId))
      .get();
    expect(invite?.acceptedAt).toBeTruthy();
  });

  test("matches the invited email case-insensitively", async () => {
    const { token, email } = await seedTeamAndInvite("member");
    const userId = await seedUser(email.toUpperCase());

    const outcome = await acceptInvitationByToken(token, userId);
    expect(outcome.status).toBe("accepted");
    if (outcome.status === "accepted") cleanup.memberIds.push(outcome.result.membershipId);
  });

  test("is idempotent — accepting twice does not create a duplicate membership", async () => {
    const { token, teamId, email } = await seedTeamAndInvite();
    const userId = await seedUser(email);

    const first = await acceptInvitationByToken(token, userId);
    const second = await acceptInvitationByToken(token, userId);
    expect(first.status).toBe("accepted");
    expect(second.status).toBe("accepted");
    if (first.status !== "accepted" || second.status !== "accepted") return;
    cleanup.memberIds.push(first.result.membershipId);

    expect(first.result.alreadyMember).toBe(false);
    expect(second.result.alreadyMember).toBe(true);
    expect(second.result.membershipId).toBe(first.result.membershipId);

    const memberships = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, teamId),
          eq(schema.teamMembers.userId, userId)
        )
      )
      .all();
    expect(memberships.length).toBe(1);
  });

  test("returns not_found for an unknown token", async () => {
    const userId = await seedUser(`${testId("u")}@example.com`);
    const outcome = await acceptInvitationByToken(generateId(), userId);
    expect(outcome.status).toBe("not_found");
  });

  test("returns forbidden and does not consume the invite when emails differ", async () => {
    const { token, teamId, inviteId } = await seedTeamAndInvite("member");
    // A user whose email does NOT match the invitation.
    const userId = await seedUser(`${testId("intruder")}@example.com`);

    const outcome = await acceptInvitationByToken(token, userId);
    expect(outcome.status).toBe("forbidden");

    // No membership was created and the invite was left untouched.
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
    expect(membership).toBeUndefined();

    const invite = await db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.id, inviteId))
      .get();
    expect(invite?.acceptedAt).toBeNull();
  });
});

describe("acceptPendingInvitationsForUser", () => {
  test("materialises invitations addressed to the user's email on sign-in", async () => {
    const { email, teamId } = await seedTeamAndInvite("member");
    const userId = await seedUser(email);

    const results = await acceptPendingInvitationsForUser({ userId });
    expect(results.length).toBe(1);
    cleanup.memberIds.push(results[0].membershipId);

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
    expect(membership).toBeTruthy();
  });

  test("is a no-op when there are no pending invitations", async () => {
    const userId = await seedUser(`${testId("nobody")}@example.com`);
    const results = await acceptPendingInvitationsForUser({ userId });
    expect(results).toEqual([]);
  });

  test("does not re-process invitations that were already accepted", async () => {
    const { email } = await seedTeamAndInvite("member");
    const userId = await seedUser(email);

    const first = await acceptPendingInvitationsForUser({ userId });
    cleanup.memberIds.push(first[0].membershipId);
    const second = await acceptPendingInvitationsForUser({ userId });

    expect(first.length).toBe(1);
    expect(second.length).toBe(0);
  });

  test("matches the user's verified email case-insensitively", async () => {
    const { email, teamId } = await seedTeamAndInvite("member");
    // The user row stores the email in a different case than the invitation.
    const userId = await seedUser(email.toUpperCase());

    const results = await acceptPendingInvitationsForUser({ userId });
    expect(results.length).toBe(1);
    cleanup.memberIds.push(results[0].membershipId);

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
    expect(membership).toBeTruthy();
  });
});
