import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { dirname, join } from "path";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashToken } from "../lib/crypto.js";
import { config } from "../lib/config.js";
import type { AppEnv } from "../lib/types.js";
import {
  buildSignedContentUrl,
  draftListResponse,
  validContentSignature,
} from "./drafts.js";
import draftRoutes from "./drafts.js";

const routeApp = new Hono<AppEnv>();
routeApp.route("/api/drafts", draftRoutes);

const cleanup = {
  draftIds: [] as string[],
  tokenIds: [] as string[],
  userIds: [] as string[],
  draftDirs: [] as string[],
};

afterEach(async () => {
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
  await Promise.all(
    cleanup.draftDirs.map((dir) => rm(dir, { recursive: true, force: true }))
  );

  cleanup.draftIds = [];
  cleanup.tokenIds = [];
  cleanup.userIds = [];
  cleanup.draftDirs = [];
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

async function seedDraft(params: {
  ownerUserId: string;
  title: string;
  createdAt: string;
}): Promise<{ id: string; dir: string }> {
  const draftId = testId("draft");
  const storagePath = `_drafts/${draftId}/index.html`;
  const dir = join(config.DATA_DIR, "drafts", "_drafts", draftId);
  const absolutePath = join(config.DATA_DIR, "drafts", storagePath);
  const html = `<!doctype html><title>${params.title}</title>`;
  const content = new TextEncoder().encode(html);
  const contentSha256 = new Bun.CryptoHasher("sha256")
    .update(content.buffer)
    .digest("hex");

  await mkdir(dirname(absolutePath), { recursive: true });
  await Bun.write(absolutePath, html);
  await db.insert(schema.drafts).values({
    id: draftId,
    ownerUserId: params.ownerUserId,
    storagePath,
    title: params.title,
    sourceFilename: `${params.title.toLowerCase().replace(/\s+/g, "-")}.html`,
    sizeBytes: content.byteLength,
    contentSha256,
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
  });

  cleanup.draftIds.push(draftId);
  cleanup.draftDirs.push(dir);
  return { id: draftId, dir };
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

describe("draft route helpers", () => {
  test("formats draft list responses newest first with management metadata", () => {
    const result = draftListResponse([
      {
        id: "dr_old",
        title: "Old Plan",
        sourceFilename: "old.html",
        sizeBytes: 12,
        createdAt: "2026-06-12T00:00:00.000Z",
        updatedAt: "2026-06-12T01:00:00.000Z",
      },
      {
        id: "dr_new",
        title: "New Plan",
        sourceFilename: "new.html",
        sizeBytes: 34,
        createdAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T01:00:00.000Z",
      },
    ]);

    expect(result.map((draft) => draft.id)).toEqual(["dr_new", "dr_old"]);
    expect(result[0]).toEqual({
      id: "dr_new",
      url: "http://localhost:3000/d/dr_new",
      title: "New Plan",
      sourceFilename: "new.html",
      sizeBytes: 34,
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T01:00:00.000Z",
    });
  });

  test("builds signed content URLs on CONTENT_ORIGIN", () => {
    const url = new URL(buildSignedContentUrl("dr_123", "abc123"));

    expect(url.origin).toBe("http://localhost:3000");
    expect(url.pathname).toBe("/draft-content/dr_123");
    expect(url.searchParams.get("exp")).toBeTruthy();
    expect(url.searchParams.get("sig")).toBeTruthy();
  });

  test("validates signatures only for the matching draft and content hash", () => {
    const url = new URL(buildSignedContentUrl("dr_123", "abc123"));
    const exp = url.searchParams.get("exp") ?? undefined;
    const sig = url.searchParams.get("sig") ?? undefined;

    expect(validContentSignature("dr_123", "abc123", exp, sig)).toBe(true);
    expect(validContentSignature("dr_456", "abc123", exp, sig)).toBe(false);
    expect(validContentSignature("dr_123", "changed", exp, sig)).toBe(false);
    expect(validContentSignature("dr_123", "abc123", "1", sig)).toBe(false);
    expect(validContentSignature("dr_123", "abc123", exp, "bad")).toBe(false);
  });

  test("lists only owner drafts newest first", async () => {
    const ownerId = await seedUser("Owner");
    const otherId = await seedUser("Other");
    const token = await seedToken(ownerId, "draft:read");
    const oldDraft = await seedDraft({
      ownerUserId: ownerId,
      title: "Old Draft",
      createdAt: "2026-06-12T00:00:00.000Z",
    });
    const newDraft = await seedDraft({
      ownerUserId: ownerId,
      title: "New Draft",
      createdAt: "2026-06-13T00:00:00.000Z",
    });
    await seedDraft({
      ownerUserId: otherId,
      title: "Other Draft",
      createdAt: "2026-06-14T00:00:00.000Z",
    });

    const res = await routeApp.request("/api/drafts", {
      headers: authHeaders(token),
    });
    const body = (await res.json()) as { data: { id: string }[] };

    expect(res.status).toBe(200);
    expect(body.data.map((draft) => draft.id)).toEqual([
      newDraft.id,
      oldDraft.id,
    ]);
  });

  test("requires read scope for draft list and lookup API tokens", async () => {
    const ownerId = await seedUser("Reader");
    const readToken = await seedToken(ownerId, "draft:read");
    const writeToken = await seedToken(ownerId, "draft:write");
    const draft = await seedDraft({
      ownerUserId: ownerId,
      title: "Readable Draft",
      createdAt: "2026-06-13T00:00:00.000Z",
    });

    const deniedList = await routeApp.request("/api/drafts", {
      headers: authHeaders(writeToken),
    });
    const deniedLookup = await routeApp.request(`/api/drafts/${draft.id}`, {
      headers: authHeaders(writeToken),
    });
    const allowedLookup = await routeApp.request(`/api/drafts/${draft.id}`, {
      headers: authHeaders(readToken),
    });

    expect(deniedList.status).toBe(403);
    expect(deniedLookup.status).toBe(403);
    expect(allowedLookup.status).toBe(200);
  });

  test("requires owner write scope for delete and removes stored content", async () => {
    const ownerId = await seedUser("Deleter");
    const otherId = await seedUser("Intruder");
    const readToken = await seedToken(ownerId, "draft:read");
    const ownerWriteToken = await seedToken(ownerId, "draft:write");
    const otherWriteToken = await seedToken(otherId, "draft:write");
    const draft = await seedDraft({
      ownerUserId: ownerId,
      title: "Delete Draft",
      createdAt: "2026-06-13T00:00:00.000Z",
    });

    const readOnlyDelete = await routeApp.request(`/api/drafts/${draft.id}`, {
      method: "DELETE",
      headers: authHeaders(readToken),
    });
    const crossOwnerDelete = await routeApp.request(`/api/drafts/${draft.id}`, {
      method: "DELETE",
      headers: authHeaders(otherWriteToken),
    });
    const ownerDelete = await routeApp.request(`/api/drafts/${draft.id}`, {
      method: "DELETE",
      headers: authHeaders(ownerWriteToken),
    });
    const remainingDraft = await db
      .select()
      .from(schema.drafts)
      .where(eq(schema.drafts.id, draft.id))
      .get();

    expect(readOnlyDelete.status).toBe(403);
    expect(crossOwnerDelete.status).toBe(403);
    expect(ownerDelete.status).toBe(200);
    expect(remainingDraft).toBeUndefined();
    expect(existsSync(draft.dir)).toBe(false);
  });
});
