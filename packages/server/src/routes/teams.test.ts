import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { AppEnv } from "../lib/types.js";
import teamRoutes from "./teams.js";

const cleanup = {
  shareIds: [] as string[],
  repoIds: [] as string[],
  teamIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.shareIds.length)
    await db.delete(schema.shares).where(inArray(schema.shares.id, cleanup.shareIds)).run();
  if (cleanup.repoIds.length)
    await db.delete(schema.repos).where(inArray(schema.repos.id, cleanup.repoIds)).run();
  if (cleanup.teamIds.length)
    await db.delete(schema.teams).where(inArray(schema.teams.id, cleanup.teamIds)).run();
  if (cleanup.userIds.length)
    await db.delete(schema.users).where(inArray(schema.users.id, cleanup.userIds)).run();
  cleanup.shareIds = [];
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
});
