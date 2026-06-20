import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { mkdir, readFile, rm } from "fs/promises";
import { dirname, join } from "path";
import { createHmac, timingSafeEqual } from "crypto";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireScope } from "../middleware/requireScope.js";
import { config } from "../lib/config.js";
import { generateId } from "../lib/crypto.js";
import { resolveInside } from "../lib/security.js";
import {
  buildDraftStoragePath,
  buildDraftShellHtml,
  draftContentSecurityHeaders,
  extractDraftTitle,
  sha256Hex,
  validateDraftUpload,
} from "../services/drafts.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();
const CONTENT_URL_TTL_MS = 5 * 60 * 1000;

interface DraftResponse {
  id: string;
  url: string;
  title: string;
  createdAt: string;
}

interface DraftListRecord extends DraftResponse {
  sourceFilename: string;
  sizeBytes: number;
  updatedAt: string;
}

function baseUrl(): string {
  return config.API_URL.replace(/\/+$/, "");
}

function contentOrigin(): string {
  return config.CONTENT_ORIGIN.replace(/\/+$/, "");
}

function draftResponse(draft: {
  id: string;
  title: string;
  createdAt: string;
}): DraftResponse {
  return {
    id: draft.id,
    url: `${baseUrl()}/d/${draft.id}`,
    title: draft.title,
    createdAt: draft.createdAt,
  };
}

function draftListItemResponse(draft: {
  id: string;
  title: string;
  sourceFilename: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}): DraftListRecord {
  return {
    ...draftResponse(draft),
    sourceFilename: draft.sourceFilename,
    sizeBytes: draft.sizeBytes,
    updatedAt: draft.updatedAt,
  };
}

export function draftListResponse(
  drafts: {
    id: string;
    title: string;
    sourceFilename: string;
    sizeBytes: number;
    createdAt: string;
    updatedAt: string;
  }[]
): DraftListRecord[] {
  return [...drafts]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(draftListItemResponse);
}

function draftsBaseDir(): string {
  return join(config.DATA_DIR, "drafts");
}

function draftStorageAbsolutePath(storagePath: string): string | null {
  return resolveInside(draftsBaseDir(), storagePath);
}

function signDraftContentUrl(draftId: string, expiresAtMs: number, contentSha256: string): string {
  const payload = `${draftId}.${expiresAtMs}.${contentSha256}`;
  return createHmac("sha256", config.DRAFT_CONTENT_SECRET).update(payload).digest("hex");
}

export function buildSignedContentUrl(draftId: string, contentSha256: string): string {
  const expiresAtMs = Date.now() + CONTENT_URL_TTL_MS;
  const sig = signDraftContentUrl(draftId, expiresAtMs, contentSha256);
  return `${contentOrigin()}/draft-content/${draftId}?exp=${expiresAtMs}&sig=${sig}`;
}

export function validContentSignature(
  draftId: string,
  contentSha256: string,
  expiresAt: string | undefined,
  sig: string | undefined
): boolean {
  if (!expiresAt || !sig) return false;
  const expiresAtMs = Number(expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return false;
  const expected = Buffer.from(signDraftContentUrl(draftId, expiresAtMs, contentSha256), "hex");
  const actual = Buffer.from(sig, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

app.post("/", requireAuth, requireScope("draft:write"), async (c) => {
  const userId = c.get("userId");
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!user) return c.json({ error: "User not found" }, 404);

  const formData = await c.req.formData();
  const fileEntry = formData.get("file") as unknown;

  if (!(fileEntry instanceof File)) {
    return c.json({ error: "Draft file is required" }, 400);
  }

  const validation = validateDraftUpload(fileEntry.name, fileEntry.size, fileEntry.type);
  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const content = await fileEntry.arrayBuffer();
  const titleOverride = formData.get("title");
  const html = new TextDecoder().decode(content);
  const title =
    typeof titleOverride === "string" && titleOverride.trim()
      ? titleOverride.trim().slice(0, 160)
      : extractDraftTitle(html, fileEntry.name);

  const draftId = generateId();
  const storagePath = buildDraftStoragePath(draftId);
  const absolutePath = draftStorageAbsolutePath(storagePath);
  if (!absolutePath) return c.json({ error: "Invalid draft path" }, 400);

  await mkdir(dirname(absolutePath), { recursive: true });
  await Bun.write(absolutePath, content);

  const now = new Date().toISOString();
  await db.insert(schema.drafts).values({
    id: draftId,
    ownerUserId: user.id,
    storagePath,
    title,
    sourceFilename: fileEntry.name,
    sizeBytes: content.byteLength,
    contentSha256: sha256Hex(content),
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ data: draftResponse({ id: draftId, title, createdAt: now }) });
});

app.get("/", requireAuth, requireScope("draft:read"), async (c) => {
  const userId = c.get("userId");
  const drafts = await db
    .select()
    .from(schema.drafts)
    .where(eq(schema.drafts.ownerUserId, userId))
    .orderBy(desc(schema.drafts.createdAt));

  return c.json({ data: draftListResponse(drafts) });
});

app.get("/:draftId", requireAuth, requireScope("draft:read"), async (c) => {
  const userId = c.get("userId");
  const draftId = c.req.param("draftId");
  const draft = await db
    .select()
    .from(schema.drafts)
    .where(eq(schema.drafts.id, draftId))
    .get();

  if (!draft) return c.json({ error: "Draft not found" }, 404);
  if (draft.ownerUserId !== userId) return c.json({ error: "Access denied" }, 403);

  return c.json({ data: draftResponse(draft) });
});

app.post("/:draftId/duplicate", requireAuth, requireScope("draft:write"), async (c) => {
  const userId = c.get("userId");
  const draftId = c.req.param("draftId");
  const source = await db
    .select()
    .from(schema.drafts)
    .where(eq(schema.drafts.id, draftId))
    .get();

  if (!source) return c.json({ error: "Draft not found" }, 404);
  if (source.ownerUserId !== userId) return c.json({ error: "Access denied" }, 403);

  const sourceAbsolute = draftStorageAbsolutePath(source.storagePath);
  if (!sourceAbsolute) return c.json({ error: "Invalid draft path" }, 400);

  let content: Buffer;
  try {
    content = await readFile(sourceAbsolute);
  } catch {
    return c.json({ error: "Draft content not found" }, 404);
  }

  const newDraftId = generateId();
  const storagePath = buildDraftStoragePath(newDraftId);
  const absolutePath = draftStorageAbsolutePath(storagePath);
  if (!absolutePath) return c.json({ error: "Invalid draft path" }, 400);

  await mkdir(dirname(absolutePath), { recursive: true });
  await Bun.write(absolutePath, content);

  const title = `${source.title} (copy)`.slice(0, 160);
  const now = new Date().toISOString();
  await db.insert(schema.drafts).values({
    id: newDraftId,
    ownerUserId: userId,
    storagePath,
    title,
    sourceFilename: source.sourceFilename,
    sizeBytes: content.byteLength,
    contentSha256: sha256Hex(new Uint8Array(content).buffer as ArrayBuffer),
    createdAt: now,
    updatedAt: now,
  });

  return c.json(
    { data: draftResponse({ id: newDraftId, title, createdAt: now }) },
    201
  );
});

app.delete("/:draftId", requireAuth, requireScope("draft:write"), async (c) => {
  const userId = c.get("userId");
  const draftId = c.req.param("draftId");
  const draft = await db
    .select()
    .from(schema.drafts)
    .where(eq(schema.drafts.id, draftId))
    .get();

  if (!draft) return c.json({ error: "Draft not found" }, 404);
  if (draft.ownerUserId !== userId) return c.json({ error: "Access denied" }, 403);

  const absolutePath = draftStorageAbsolutePath(draft.storagePath);
  if (!absolutePath) return c.json({ error: "Invalid draft path" }, 400);

  try {
    await rm(dirname(absolutePath), { recursive: true, force: true });
  } catch {
    return c.json({ error: "Failed to delete draft content" }, 500);
  }

  await db.delete(schema.drafts).where(eq(schema.drafts.id, draftId)).run();

  return c.json({ data: { deleted: true } });
});

export async function renderDraftPage(draftId: string, userId: string): Promise<Response> {
  const draft = await db
    .select()
    .from(schema.drafts)
    .where(eq(schema.drafts.id, draftId))
    .get();

  if (!draft) return new Response("Draft not found", { status: 404 });
  if (draft.ownerUserId !== userId) return new Response("Access denied", { status: 403 });

  const contentPath = buildSignedContentUrl(draft.id, draft.contentSha256);
  const html = buildDraftShellHtml({ title: draft.title, contentPath });

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function serveDraftContent(
  draftId: string,
  expiresAt: string | undefined,
  sig: string | undefined
): Promise<Response> {
  const draft = await db
    .select()
    .from(schema.drafts)
    .where(eq(schema.drafts.id, draftId))
    .get();

  if (!draft) return new Response("Draft not found", { status: 404 });

  if (!validContentSignature(draft.id, draft.contentSha256, expiresAt, sig)) {
    return new Response("Invalid or expired draft content URL", { status: 403 });
  }

  const absolutePath = draftStorageAbsolutePath(draft.storagePath);
  if (!absolutePath) return new Response("Invalid draft path", { status: 400 });

  try {
    const html = await readFile(absolutePath);
    return new Response(html, {
      headers: draftContentSecurityHeaders(),
    });
  } catch {
    return new Response("Draft content not found", { status: 404 });
  }
}

export default app;
