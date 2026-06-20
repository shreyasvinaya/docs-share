import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashToken } from "../lib/crypto.js";
import type { AppEnv } from "../lib/types.js";
import siteDataRoutes, { parseTargetParam } from "./siteData.js";

const routeApp = new Hono<AppEnv>();
routeApp.route("/api/sites", siteDataRoutes);

const cleanup = {
  userIds: [] as string[],
  tokenIds: [] as string[],
  draftIds: [] as string[],
  collectionIds: [] as string[],
  recordIds: [] as string[],
};

afterEach(async () => {
  if (cleanup.recordIds.length) {
    await db
      .delete(schema.siteDataRecords)
      .where(inArray(schema.siteDataRecords.id, cleanup.recordIds))
      .run();
  }
  if (cleanup.collectionIds.length) {
    await db
      .delete(schema.siteDataCollections)
      .where(inArray(schema.siteDataCollections.id, cleanup.collectionIds))
      .run();
  }
  if (cleanup.draftIds.length) {
    await db
      .delete(schema.drafts)
      .where(inArray(schema.drafts.id, cleanup.draftIds))
      .run();
  }
  if (cleanup.tokenIds.length) {
    await db
      .delete(schema.apiTokens)
      .where(inArray(schema.apiTokens.id, cleanup.tokenIds))
      .run();
  }
  if (cleanup.userIds.length) {
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, cleanup.userIds))
      .run();
  }
  cleanup.recordIds = [];
  cleanup.collectionIds = [];
  cleanup.draftIds = [];
  cleanup.tokenIds = [];
  cleanup.userIds = [];
});

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function seedUser(label: string): Promise<string> {
  const userId = testId(`user_${label}`);
  await db.insert(schema.users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: label,
    googleId: `google_${userId}`,
  });
  cleanup.userIds.push(userId);
  return userId;
}

async function seedToken(userId: string, scopes: string): Promise<string> {
  const token = `ds_test_${testId("token")}`;
  const tokenId = testId("api_token");
  await db.insert(schema.apiTokens).values({
    id: tokenId,
    userId,
    name: "Test token",
    tokenPrefix: token.slice(0, 8),
    tokenHash: hashToken(token),
    scopes,
  });
  cleanup.tokenIds.push(tokenId);
  return token;
}

async function seedDraft(ownerUserId: string): Promise<string> {
  const draftId = testId("draft");
  await db.insert(schema.drafts).values({
    id: draftId,
    ownerUserId,
    storagePath: `_drafts/${draftId}/index.html`,
    title: "Form draft",
    sourceFilename: "form.html",
    sizeBytes: 10,
    contentSha256: "deadbeef",
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
  });
  cleanup.draftIds.push(draftId);
  return draftId;
}

async function seedCollection(params: {
  ownerUserId: string;
  targetType: "draft" | "repo";
  targetId: string;
  collection: string;
  enabled?: boolean;
}): Promise<string> {
  const id = testId("collection");
  await db.insert(schema.siteDataCollections).values({
    id,
    ownerUserId: params.ownerUserId,
    targetType: params.targetType,
    targetId: params.targetId,
    collection: params.collection,
    enabled: params.enabled ?? true,
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
  });
  cleanup.collectionIds.push(id);
  return id;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function postSubmission(
  target: string,
  collection: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return routeApp.request(`/api/sites/${target}/data/${collection}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("parseTargetParam", () => {
  test("splits a typed target", () => {
    expect(parseTargetParam("draft:abc")).toEqual({
      targetType: "draft",
      targetId: "abc",
    });
    expect(parseTargetParam("repo:r1")).toEqual({
      targetType: "repo",
      targetId: "r1",
    });
  });

  test("rejects malformed targets", () => {
    expect(parseTargetParam("abc")).toBeNull();
    expect(parseTargetParam("user:1")).toBeNull();
    expect(parseTargetParam(":id")).toBeNull();
    expect(parseTargetParam("draft:")).toBeNull();
  });
});

describe("public ingestion", () => {
  test("stores a submission for an opted-in collection and hashes the visitor", async () => {
    const ownerId = await seedUser("Owner");
    const draftId = await seedDraft(ownerId);
    await seedCollection({
      ownerUserId: ownerId,
      targetType: "draft",
      targetId: draftId,
      collection: "contact",
    });

    const res = await postSubmission(`draft:${draftId}`, "contact", {
      name: "Ada",
      email: "ada@example.com",
    });
    expect(res.status).toBe(201);

    const records = await db
      .select()
      .from(schema.siteDataRecords)
      .where(eq(schema.siteDataRecords.targetId, draftId))
      .all();
    records.forEach((r) => cleanup.recordIds.push(r.id));

    expect(records.length).toBe(1);
    expect(records[0]!.fields).toEqual({ name: "Ada", email: "ada@example.com" });
    expect(records[0]!.ownerUserId).toBe(ownerId);
    // Visitor hash is stored, never a raw IP/PII outside the fields.
    expect(records[0]!.visitorHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("rejects submissions to a collection that is not opted in", async () => {
    const ownerId = await seedUser("Owner");
    const draftId = await seedDraft(ownerId);

    const res = await postSubmission(`draft:${draftId}`, "contact", {
      name: "Ada",
    });
    expect(res.status).toBe(404);
  });

  test("rejects submissions to a disabled collection", async () => {
    const ownerId = await seedUser("Owner");
    const draftId = await seedDraft(ownerId);
    await seedCollection({
      ownerUserId: ownerId,
      targetType: "draft",
      targetId: draftId,
      collection: "contact",
      enabled: false,
    });

    const res = await postSubmission(`draft:${draftId}`, "contact", {
      name: "Ada",
    });
    expect(res.status).toBe(404);
  });

  test("rejects unknown targets and invalid collection names", async () => {
    const ownerId = await seedUser("Owner");
    const draftId = await seedDraft(ownerId);
    await seedCollection({
      ownerUserId: ownerId,
      targetType: "draft",
      targetId: draftId,
      collection: "contact",
    });

    expect((await postSubmission("user:x", "contact", { a: 1 })).status).toBe(
      404
    );
    expect(
      (await postSubmission(`draft:${draftId}`, "bad name", { a: 1 })).status
    ).toBe(400);
  });

  test("rejects malformed payloads", async () => {
    const ownerId = await seedUser("Owner");
    const draftId = await seedDraft(ownerId);
    await seedCollection({
      ownerUserId: ownerId,
      targetType: "draft",
      targetId: draftId,
      collection: "contact",
    });

    const emptyRes = await postSubmission(`draft:${draftId}`, "contact", {});
    expect(emptyRes.status).toBe(400);

    const nestedRes = await postSubmission(`draft:${draftId}`, "contact", {
      profile: { a: 1 },
    });
    expect(nestedRes.status).toBe(400);

    const badJson = await routeApp.request(
      `/api/sites/draft:${draftId}/data/contact`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }
    );
    expect(badJson.status).toBe(400);
  });

  test("rate limits a single visitor after the per-window cap", async () => {
    const ownerId = await seedUser("Owner");
    const draftId = await seedDraft(ownerId);
    await seedCollection({
      ownerUserId: ownerId,
      targetType: "draft",
      targetId: draftId,
      collection: "contact",
    });

    const ipHeader = { "x-forwarded-for": "203.0.113.99" };
    let limited = false;
    for (let i = 0; i < 25; i++) {
      const res = await postSubmission(
        `draft:${draftId}`,
        "contact",
        { i },
        ipHeader
      );
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);

    const created = await db
      .select()
      .from(schema.siteDataRecords)
      .where(eq(schema.siteDataRecords.targetId, draftId))
      .all();
    created.forEach((r) => cleanup.recordIds.push(r.id));
  });
});

describe("owner management", () => {
  test("requires owner authorization to list collections", async () => {
    const ownerId = await seedUser("Owner");
    const intruderId = await seedUser("Intruder");
    const draftId = await seedDraft(ownerId);
    await seedCollection({
      ownerUserId: ownerId,
      targetType: "draft",
      targetId: draftId,
      collection: "contact",
    });
    const ownerToken = await seedToken(ownerId, "site-data:read");
    const intruderToken = await seedToken(intruderId, "site-data:read");

    const denied = await routeApp.request(
      `/api/sites/draft:${draftId}/collections`,
      { headers: authHeaders(intruderToken) }
    );
    const allowed = await routeApp.request(
      `/api/sites/draft:${draftId}/collections`,
      { headers: authHeaders(ownerToken) }
    );

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as { data: { collection: string }[] };
    expect(body.data.map((c) => c.collection)).toContain("contact");
  });

  test("requires write scope to opt a collection in", async () => {
    const ownerId = await seedUser("Owner");
    const draftId = await seedDraft(ownerId);
    const readToken = await seedToken(ownerId, "site-data:read");
    const writeToken = await seedToken(ownerId, "site-data:write");

    const denied = await routeApp.request(
      `/api/sites/draft:${draftId}/collections`,
      {
        method: "POST",
        headers: authHeaders(readToken),
        body: JSON.stringify({ collection: "rsvp" }),
      }
    );
    expect(denied.status).toBe(403);

    const allowed = await routeApp.request(
      `/api/sites/draft:${draftId}/collections`,
      {
        method: "POST",
        headers: authHeaders(writeToken),
        body: JSON.stringify({ collection: "rsvp" }),
      }
    );
    expect(allowed.status).toBe(201);

    const created = await db
      .select()
      .from(schema.siteDataCollections)
      .where(
        and(
          eq(schema.siteDataCollections.targetId, draftId),
          eq(schema.siteDataCollections.collection, "rsvp")
        )
      )
      .all();
    created.forEach((c) => cleanup.collectionIds.push(c.id));
    expect(created.length).toBe(1);
  });

  test("lists, filters, and soft-deletes records for the owner only", async () => {
    const ownerId = await seedUser("Owner");
    const intruderId = await seedUser("Intruder");
    const draftId = await seedDraft(ownerId);
    await seedCollection({
      ownerUserId: ownerId,
      targetType: "draft",
      targetId: draftId,
      collection: "contact",
    });
    const ownerRead = await seedToken(ownerId, "site-data:read");
    const ownerWrite = await seedToken(ownerId, "site-data:write");
    const intruderWrite = await seedToken(intruderId, "site-data:write");

    await postSubmission(`draft:${draftId}`, "contact", { name: "Ada" });
    const stored = await db
      .select()
      .from(schema.siteDataRecords)
      .where(eq(schema.siteDataRecords.targetId, draftId))
      .all();
    stored.forEach((r) => cleanup.recordIds.push(r.id));
    const recordId = stored[0]!.id;

    const listed = await routeApp.request(
      `/api/sites/draft:${draftId}/records`,
      { headers: authHeaders(ownerRead) }
    );
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { data: { id: string }[] };
    expect(listBody.data.map((r) => r.id)).toContain(recordId);

    const intruderDelete = await routeApp.request(
      `/api/sites/draft:${draftId}/records/${recordId}`,
      { method: "DELETE", headers: authHeaders(intruderWrite) }
    );
    expect(intruderDelete.status).toBe(403);

    const ownerDelete = await routeApp.request(
      `/api/sites/draft:${draftId}/records/${recordId}`,
      { method: "DELETE", headers: authHeaders(ownerWrite) }
    );
    expect(ownerDelete.status).toBe(200);

    const afterDelete = await routeApp.request(
      `/api/sites/draft:${draftId}/records`,
      { headers: authHeaders(ownerRead) }
    );
    const afterBody = (await afterDelete.json()) as { data: { id: string }[] };
    expect(afterBody.data.map((r) => r.id)).not.toContain(recordId);

    const row = await db
      .select()
      .from(schema.siteDataRecords)
      .where(eq(schema.siteDataRecords.id, recordId))
      .get();
    expect(row?.deletedAt).toBeTruthy();
  });

  test("blocks unauthenticated access to owner endpoints", async () => {
    const ownerId = await seedUser("Owner");
    const draftId = await seedDraft(ownerId);

    const res = await routeApp.request(
      `/api/sites/draft:${draftId}/records`
    );
    expect(res.status).toBe(401);
  });
});
