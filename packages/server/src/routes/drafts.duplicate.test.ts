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
  if (cleanup.draftIds.length)
    await db
      .delete(schema.drafts)
      .where(inArray(schema.drafts.id, cleanup.draftIds))
      .run();
  if (cleanup.tokenIds.length)
    await db
      .delete(schema.apiTokens)
      .where(inArray(schema.apiTokens.id, cleanup.tokenIds))
      .run();
  if (cleanup.userIds.length)
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, cleanup.userIds))
      .run();
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
  const now = new Date().toISOString();

  await mkdir(dirname(absolutePath), { recursive: true });
  await Bun.write(absolutePath, html);
  await db.insert(schema.drafts).values({
    id: draftId,
    ownerUserId: params.ownerUserId,
    storagePath,
    title: params.title,
    sourceFilename: "index.html",
    sizeBytes: content.byteLength,
    contentSha256,
    createdAt: now,
    updatedAt: now,
  });

  cleanup.draftIds.push(draftId);
  cleanup.draftDirs.push(dir);
  return { id: draftId, dir };
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

describe("draft duplicate route", () => {
  test("duplicates a draft into an independent copy", async () => {
    const ownerId = await seedUser("Owner");
    const token = await seedToken(ownerId, "draft:write");
    const original = await seedDraft({ ownerUserId: ownerId, title: "Plan" });

    const res = await routeApp.request(`/api/drafts/${original.id}/duplicate`, {
      method: "POST",
      headers: authHeaders(token),
    });
    const body = (await res.json()) as {
      data: { id: string; title: string; url: string };
    };

    expect(res.status).toBe(201);
    expect(body.data.id).not.toBe(original.id);
    expect(body.data.title).toBe("Plan (copy)");
    cleanup.draftIds.push(body.data.id);

    // Independent stored content + db row.
    const copy = await db
      .select()
      .from(schema.drafts)
      .where(eq(schema.drafts.id, body.data.id))
      .get();
    expect(copy).toBeTruthy();
    expect(copy?.storagePath).not.toBe(original.id);
    const copyDir = join(
      config.DATA_DIR,
      "drafts",
      dirname(copy!.storagePath)
    );
    cleanup.draftDirs.push(copyDir);
    expect(existsSync(join(config.DATA_DIR, "drafts", copy!.storagePath))).toBe(
      true
    );

    // Deleting the original leaves the copy untouched.
    await routeApp.request(`/api/drafts/${original.id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(existsSync(join(config.DATA_DIR, "drafts", copy!.storagePath))).toBe(
      true
    );
  });

  test("requires write scope to duplicate", async () => {
    const ownerId = await seedUser("Owner");
    const readToken = await seedToken(ownerId, "draft:read");
    const original = await seedDraft({ ownerUserId: ownerId, title: "Plan" });

    const res = await routeApp.request(`/api/drafts/${original.id}/duplicate`, {
      method: "POST",
      headers: authHeaders(readToken),
    });

    expect(res.status).toBe(403);
  });

  test("denies duplicating another user's draft", async () => {
    const ownerId = await seedUser("Owner");
    const intruderId = await seedUser("Intruder");
    const intruderToken = await seedToken(intruderId, "draft:write");
    const original = await seedDraft({ ownerUserId: ownerId, title: "Plan" });

    const res = await routeApp.request(`/api/drafts/${original.id}/duplicate`, {
      method: "POST",
      headers: authHeaders(intruderToken),
    });

    expect(res.status).toBe(403);
  });
});
