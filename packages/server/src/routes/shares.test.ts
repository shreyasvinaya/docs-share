import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { AppEnv } from "../lib/types.js";
import shareRoutes from "./shares.js";

const cleanup = {
  recipientIds: [] as string[],
  shareIds: [] as string[],
  repoIds: [] as string[],
  teamIds: [] as string[],
  userIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.recipientIds.length)
    await db.delete(schema.shareRecipients).where(inArray(schema.shareRecipients.id, cleanup.recipientIds)).run();
  if (cleanup.shareIds.length)
    await db.delete(schema.shares).where(inArray(schema.shares.id, cleanup.shareIds)).run();
  if (cleanup.repoIds.length)
    await db.delete(schema.repos).where(inArray(schema.repos.id, cleanup.repoIds)).run();
  if (cleanup.teamIds.length) {
    await db.delete(schema.teamMembers).where(inArray(schema.teamMembers.teamId, cleanup.teamIds)).run();
    await db.delete(schema.teams).where(inArray(schema.teams.id, cleanup.teamIds)).run();
  }
  if (cleanup.userIds.length)
    await db.delete(schema.users).where(inArray(schema.users.id, cleanup.userIds)).run();
  cleanup.recipientIds = [];
  cleanup.shareIds = [];
  cleanup.repoIds = [];
  cleanup.teamIds = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function appAs(userId: string) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    return next();
  });
  app.route("/api/shares", shareRoutes);
  return app;
}

async function seedEmailShare() {
  const ownerId = testId("owner");
  const recipientUserId = testId("recipient");
  const recipientEmail = `${recipientUserId}@example.com`;
  const repoId = testId("repo");
  const shareId = testId("share");
  const recipientId = testId("rcpt");

  await db.insert(schema.users).values([
    { id: ownerId, email: `${ownerId}@example.com`, displayName: "Owner", googleId: `g_${ownerId}` },
    { id: recipientUserId, email: recipientEmail, displayName: "Recipient", googleId: `g_${recipientUserId}` },
  ]);
  await db.insert(schema.repos).values({
    id: repoId,
    ownerType: "user",
    ownerUserId: ownerId,
    diskPath: `/tmp/${repoId}.git`,
  });
  await db.insert(schema.shares).values({
    id: shareId,
    repoId,
    createdById: ownerId,
    shareType: "email",
    permission: "read",
  });
  await db.insert(schema.shareRecipients).values({
    id: recipientId,
    shareId,
    email: recipientEmail,
    userId: null,
  });

  cleanup.userIds.push(ownerId, recipientUserId);
  cleanup.repoIds.push(repoId);
  cleanup.shareIds.push(shareId);
  cleanup.recipientIds.push(recipientId);
  return { ownerId, recipientUserId, recipientEmail, shareId, recipientId };
}

// Seed a team-owned repo with an owner (team owner + share creator) and a
// second non-creator team member who still has repo access (role "member").
async function seedTeamRepoWithPublicShare(options?: {
  linkAccess?: "public" | "org";
  passwordHash?: string | null;
  expiresAt?: string | null;
  publicToken?: string;
}) {
  const creatorId = testId("creator");
  const otherMemberId = testId("other");
  const teamId = testId("team");
  const repoId = testId("repo");
  const shareId = testId("share");
  const memberRowA = testId("tm");
  const memberRowB = testId("tm");
  const publicToken = options?.publicToken ?? testId("tok");

  await db.insert(schema.users).values([
    { id: creatorId, email: `${creatorId}@example.com`, displayName: "Creator", googleId: `g_${creatorId}` },
    { id: otherMemberId, email: `${otherMemberId}@example.com`, displayName: "Other", googleId: `g_${otherMemberId}` },
  ]);
  await db.insert(schema.teams).values({
    id: teamId,
    name: "Team",
    slug: testId("slug"),
    ownerId: creatorId,
  });
  await db.insert(schema.repos).values({
    id: repoId,
    ownerType: "team",
    ownerTeamId: teamId,
    diskPath: `/tmp/${repoId}.git`,
  });
  await db.insert(schema.teamMembers).values([
    { id: memberRowA, teamId, userId: creatorId, role: "owner" },
    { id: memberRowB, teamId, userId: otherMemberId, role: "member" },
  ]);
  await db.insert(schema.shares).values({
    id: shareId,
    repoId,
    path: "index.html",
    createdById: creatorId,
    shareType: "public_link",
    permission: "read",
    publicToken,
    linkAccess: options?.linkAccess ?? "org",
    orgDomain: options?.linkAccess === "public" ? null : "example.com",
    passwordHash: options?.passwordHash ?? null,
    expiresAt: options?.expiresAt ?? null,
  });

  cleanup.userIds.push(creatorId, otherMemberId);
  cleanup.repoIds.push(repoId);
  cleanup.shareIds.push(shareId);
  cleanup.teamIds.push(teamId);
  return { creatorId, otherMemberId, teamId, repoId, shareId, publicToken };
}

describe("POST /api/shares (public_link update authz)", () => {
  test("a non-creator team member cannot hijack/downgrade another user's share", async () => {
    const { otherMemberId, repoId, shareId, publicToken } =
      await seedTeamRepoWithPublicShare({ linkAccess: "org" });

    const res = await appAs(otherMemberId).request("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoId,
        path: "index.html",
        shareType: "public_link",
        linkAccess: "public",
      }),
    });
    expect(res.status).toBe(403);

    // The share was NOT mutated: still org-restricted, same token.
    const row = await db
      .select()
      .from(schema.shares)
      .where(eq(schema.shares.id, shareId))
      .get();
    expect(row?.linkAccess).toBe("org");
    expect(row?.publicToken).toBe(publicToken);
  });

  test("the creator can update their own share", async () => {
    const { creatorId, repoId, shareId } = await seedTeamRepoWithPublicShare({
      linkAccess: "org",
    });

    const res = await appAs(creatorId).request("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoId,
        path: "index.html",
        shareType: "public_link",
        linkAccess: "org",
      }),
    });
    expect(res.status).toBe(200);

    const row = await db
      .select()
      .from(schema.shares)
      .where(eq(schema.shares.id, shareId))
      .get();
    expect(row?.linkAccess).toBe("org");
  });

  test("loosening access (org -> public) rotates the publicToken", async () => {
    const { creatorId, repoId, shareId, publicToken } =
      await seedTeamRepoWithPublicShare({ linkAccess: "org" });

    const res = await appAs(creatorId).request("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoId,
        path: "index.html",
        shareType: "public_link",
        linkAccess: "public",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { publicToken: string | null } };
    expect(body.data.publicToken).toBeTruthy();
    expect(body.data.publicToken).not.toBe(publicToken);

    const row = await db
      .select()
      .from(schema.shares)
      .where(eq(schema.shares.id, shareId))
      .get();
    expect(row?.linkAccess).toBe("public");
    expect(row?.publicToken).not.toBe(publicToken);
  });

  test("removing a password rotates the publicToken", async () => {
    const { creatorId, repoId, publicToken } = await seedTeamRepoWithPublicShare(
      { linkAccess: "public", passwordHash: "deadbeef" }
    );

    const res = await appAs(creatorId).request("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoId,
        path: "index.html",
        shareType: "public_link",
        linkAccess: "public",
        password: "",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { publicToken: string | null } };
    expect(body.data.publicToken).not.toBe(publicToken);
  });
});

describe("share responses never leak passwordHash", () => {
  test("/for-resource returns hasPassword but never passwordHash, and hides publicToken from non-creators", async () => {
    const { otherMemberId, repoId, publicToken } =
      await seedTeamRepoWithPublicShare({
        linkAccess: "public",
        passwordHash: "deadbeef",
      });

    const res = await appAs(otherMemberId).request(
      `/api/shares/for-resource?repoId=${repoId}&path=index.html`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(body.data.length).toBeGreaterThan(0);
    const share = body.data[0]!;
    expect("passwordHash" in share).toBe(false);
    expect(share.hasPassword).toBe(true);
    // Non-creator must not receive the live token.
    expect(share.publicToken).toBeNull();
    expect(share.publicToken).not.toBe(publicToken);
  });

  test("/for-resource returns the publicToken to the creator", async () => {
    const { creatorId, repoId, publicToken } =
      await seedTeamRepoWithPublicShare({ linkAccess: "public" });

    const res = await appAs(creatorId).request(
      `/api/shares/for-resource?repoId=${repoId}&path=index.html`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
    };
    const share = body.data[0]!;
    expect("passwordHash" in share).toBe(false);
    expect(share.publicToken).toBe(publicToken);
  });

  test("/incoming embeds hasPassword and never passwordHash", async () => {
    const { recipientUserId, recipientEmail, shareId } = await seedEmailShare();
    // Give the email share a password hash to prove it is projected away.
    await db
      .update(schema.shares)
      .set({ passwordHash: "deadbeef" })
      .where(eq(schema.shares.id, shareId))
      .run();
    // Stamp the recipient so /incoming surfaces it (matched by email regardless).
    void recipientEmail;

    const res = await appAs(recipientUserId).request("/api/shares/incoming");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ share: Record<string, unknown> }>;
    };
    expect(body.data.length).toBeGreaterThan(0);
    for (const item of body.data) {
      expect("passwordHash" in item.share).toBe(false);
      expect("hasPassword" in item.share).toBe(true);
      // Recipient is not the creator, so no token leaks.
      expect(item.share.publicToken).toBeNull();
    }
  });
});

describe("POST /api/shares/:shareId/accept", () => {
  test("stamps acceptedAt and links the recipient to the user", async () => {
    const { recipientUserId, shareId, recipientId } = await seedEmailShare();

    const res = await appAs(recipientUserId).request(
      `/api/shares/${shareId}/accept`,
      { method: "POST" }
    );
    expect(res.status).toBe(200);

    const recipient = await db
      .select()
      .from(schema.shareRecipients)
      .where(eq(schema.shareRecipients.id, recipientId))
      .get();
    expect(recipient?.acceptedAt).toBeTruthy();
    expect(recipient?.userId).toBe(recipientUserId);
  });

  test("is idempotent — keeps the original acceptedAt on repeat accept", async () => {
    const { recipientUserId, shareId, recipientId } = await seedEmailShare();

    const first = await appAs(recipientUserId).request(
      `/api/shares/${shareId}/accept`,
      { method: "POST" }
    );
    expect(first.status).toBe(200);
    const firstRow = await db
      .select()
      .from(schema.shareRecipients)
      .where(eq(schema.shareRecipients.id, recipientId))
      .get();
    const firstAcceptedAt = firstRow?.acceptedAt;

    const second = await appAs(recipientUserId).request(
      `/api/shares/${shareId}/accept`,
      { method: "POST" }
    );
    expect(second.status).toBe(200);
    const secondRow = await db
      .select()
      .from(schema.shareRecipients)
      .where(eq(schema.shareRecipients.id, recipientId))
      .get();
    expect(secondRow?.acceptedAt).toBe(firstAcceptedAt!);
  });

  test("returns 404 when the user is not a recipient", async () => {
    const { shareId } = await seedEmailShare();
    const strangerId = testId("stranger");
    await db.insert(schema.users).values({
      id: strangerId,
      email: `${strangerId}@example.com`,
      displayName: "Stranger",
      googleId: `g_${strangerId}`,
    });
    cleanup.userIds.push(strangerId);

    const res = await appAs(strangerId).request(
      `/api/shares/${shareId}/accept`,
      { method: "POST" }
    );
    expect(res.status).toBe(404);
  });
});
