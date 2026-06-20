import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireScope } from "../middleware/requireScope.js";
import { config } from "../lib/config.js";
import { generateId } from "../lib/crypto.js";
import { resolveClientIp } from "../lib/clientIp.js";
import {
  RateLimiter,
  hashVisitor,
  isSiteDataTargetType,
  normalizeCollectionName,
  validateSubmissionFields,
  type SiteDataTargetType,
} from "../services/siteData.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

// Public ingestion is unauthenticated, so cap abuse. Per-visitor and per-IP
// buckets guard against single-source floods, and a coarse global bucket caps
// broad spam waves.
const PER_VISITOR_LIMIT = 20;
const PER_VISITOR_WINDOW_MS = 60 * 1000;
const PER_IP_LIMIT = 600;
const PER_IP_WINDOW_MS = 60 * 1000;
const GLOBAL_LIMIT = 600;
const GLOBAL_WINDOW_MS = 60 * 1000;

const visitorLimiter = new RateLimiter(PER_VISITOR_LIMIT, PER_VISITOR_WINDOW_MS);
// Per-IP bucket. The old 600/min was a SINGLE shared global bucket, so one
// source flooding it starved every other source. Keying the same budget per
// trusted client IP means an abusive IP exhausts only its own bucket, leaving
// other IPs unaffected. The global bucket remains as an absolute ceiling.
const ipLimiter = new RateLimiter(PER_IP_LIMIT, PER_IP_WINDOW_MS);
const globalLimiter = new RateLimiter(GLOBAL_LIMIT, GLOBAL_WINDOW_MS);

/**
 * Test-only helper to clear the in-memory ingestion limiters between cases.
 * Untrusted callers now collapse onto a single shared client-IP bucket (no
 * spoofable X-Forwarded-For), so without a reset one test's successful POSTs
 * could exhaust the per-visitor budget for the next.
 */
export function __resetSiteDataLimiters(): void {
  visitorLimiter.reset();
  ipLimiter.reset();
  globalLimiter.reset();
}

interface ResolvedTarget {
  targetType: SiteDataTargetType;
  targetId: string;
  ownerUserId: string;
}

/**
 * Parse the `:target` route param ("draft:<id>" | "repo:<id>") into a typed
 * target. Returns null on any malformed value so the public endpoint can fail
 * closed with a 404.
 */
export function parseTargetParam(
  raw: string
): { targetType: SiteDataTargetType; targetId: string } | null {
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  const targetType = raw.slice(0, idx);
  const targetId = raw.slice(idx + 1);
  if (!isSiteDataTargetType(targetType) || !targetId) return null;
  return { targetType, targetId };
}

async function resolveTarget(
  targetType: SiteDataTargetType,
  targetId: string
): Promise<ResolvedTarget | null> {
  if (targetType === "draft") {
    const draft = await db
      .select({ ownerUserId: schema.drafts.ownerUserId })
      .from(schema.drafts)
      .where(eq(schema.drafts.id, targetId))
      .get();
    if (!draft) return null;
    return { targetType, targetId, ownerUserId: draft.ownerUserId };
  }

  const repo = await db
    .select({ ownerUserId: schema.repos.ownerUserId })
    .from(schema.repos)
    .where(eq(schema.repos.id, targetId))
    .get();
  // Only user-owned repos can opt into data collection in this wave; team-owned
  // repos have no single owner_user_id to attribute records to.
  if (!repo?.ownerUserId) return null;
  return { targetType, targetId, ownerUserId: repo.ownerUserId };
}

/**
 * Authorize the current user as the manager of a target. Drafts and user-owned
 * repos are managed by their owner. Returns the resolved target when the caller
 * may manage it, otherwise null.
 */
async function authorizeManager(
  userId: string,
  targetType: SiteDataTargetType,
  targetId: string
): Promise<ResolvedTarget | null> {
  const target = await resolveTarget(targetType, targetId);
  if (!target) return null;
  if (target.ownerUserId !== userId) return null;
  return target;
}

interface SiteDataRecordResponse {
  id: string;
  collection: string;
  fields: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export function siteDataRecordResponse(record: {
  id: string;
  collection: string;
  fields: Record<string, string | number | boolean | null>;
  createdAt: string;
}): SiteDataRecordResponse {
  return {
    id: record.id,
    collection: record.collection,
    fields: record.fields,
    createdAt: record.createdAt,
  };
}

/**
 * POST /api/sites/:target/data/:collection — public form ingestion.
 *
 * No auth: callable from a sandboxed hosted page. Hardened with strict field
 * validation, rate limiting, opt-in enforcement (the target owner must have
 * created+enabled the collection), and a hashed visitor identifier (never the
 * raw IP).
 */
app.post("/:target/data/:collection", async (c) => {
  const parsed = parseTargetParam(c.req.param("target"));
  if (!parsed) return c.json({ error: "Unknown target" }, 404);

  const collection = normalizeCollectionName(c.req.param("collection"));
  if (!collection) return c.json({ error: "Invalid collection name" }, 400);

  // Absolute global ceiling first (cheap, no DB).
  if (!globalLimiter.check("global").allowed) {
    return c.json({ error: "Too many requests" }, 429);
  }

  // Trusted client IP (honors TRUST_PROXY; never trusts client X-Forwarded-For)
  // so a single source cannot mint fresh per-visitor buckets via header spoofing.
  const ip = resolveClientIp(c);

  // Per-IP bucket so one source flooding the endpoint exhausts only its own
  // budget and cannot starve other sources (the old single global bucket did).
  if (!ipLimiter.check(`ip:${ip}`).allowed) {
    return c.json({ error: "Too many requests" }, 429);
  }

  const userAgent = c.req.header("User-Agent") ?? null;
  const visitorHash = hashVisitor({ ip, userAgent }, config.SESSION_SECRET);

  if (!visitorLimiter.check(visitorHash).allowed) {
    return c.json({ error: "Too many requests" }, 429);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const validation = validateSubmissionFields(payload);
  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  // Enforce opt-in: the collection must exist AND be enabled for this target.
  const optIn = await db
    .select({
      ownerUserId: schema.siteDataCollections.ownerUserId,
      enabled: schema.siteDataCollections.enabled,
    })
    .from(schema.siteDataCollections)
    .where(
      and(
        eq(schema.siteDataCollections.targetType, parsed.targetType),
        eq(schema.siteDataCollections.targetId, parsed.targetId),
        eq(schema.siteDataCollections.collection, collection)
      )
    )
    .get();

  if (!optIn || !optIn.enabled) {
    return c.json({ error: "This form is not accepting submissions" }, 404);
  }

  // Re-resolve the target to confirm it still exists. The opt-in row has no FK
  // to the draft/repo, so a deleted target can leave an orphaned collection
  // behind; without this check an attacker could keep POSTing dead-target rows.
  const target = await resolveTarget(parsed.targetType, parsed.targetId);
  if (!target || target.ownerUserId !== optIn.ownerUserId) {
    return c.json({ error: "This form is not accepting submissions" }, 404);
  }

  const now = new Date().toISOString();
  await db.insert(schema.siteDataRecords).values({
    id: generateId(),
    ownerUserId: optIn.ownerUserId,
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    collection,
    fields: validation.fields,
    visitorHash,
    createdAt: now,
  });

  visitorLimiter.prune();
  ipLimiter.prune();
  globalLimiter.prune();

  return c.json({ data: { received: true } }, 201);
});

// ---- Owner management endpoints (authenticated) ----

app.use("/:target/collections", requireAuth);
app.use("/:target/collections/*", requireAuth);
app.use("/:target/records", requireAuth);
app.use("/:target/records/*", requireAuth);

/**
 * GET /api/sites/:target/collections — list opt-in collections for a target.
 */
app.get(
  "/:target/collections",
  requireScope("site-data:read"),
  async (c) => {
    const parsed = parseTargetParam(c.req.param("target"));
    if (!parsed) return c.json({ error: "Unknown target" }, 404);

    const userId = c.get("userId");
    const target = await authorizeManager(
      userId,
      parsed.targetType,
      parsed.targetId
    );
    if (!target) return c.json({ error: "Access denied" }, 403);

    const collections = await db
      .select()
      .from(schema.siteDataCollections)
      .where(
        and(
          eq(schema.siteDataCollections.targetType, parsed.targetType),
          eq(schema.siteDataCollections.targetId, parsed.targetId)
        )
      )
      .orderBy(desc(schema.siteDataCollections.createdAt));

    return c.json({
      data: collections.map((collection) => ({
        id: collection.id,
        collection: collection.collection,
        enabled: collection.enabled,
        createdAt: collection.createdAt,
        updatedAt: collection.updatedAt,
      })),
    });
  }
);

/**
 * POST /api/sites/:target/collections — opt a collection in (idempotent).
 */
app.post(
  "/:target/collections",
  requireScope("site-data:write"),
  async (c) => {
    const parsed = parseTargetParam(c.req.param("target"));
    if (!parsed) return c.json({ error: "Unknown target" }, 404);

    const userId = c.get("userId");
    const target = await authorizeManager(
      userId,
      parsed.targetType,
      parsed.targetId
    );
    if (!target) return c.json({ error: "Access denied" }, 403);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    const collection = normalizeCollectionName(
      (body as { collection?: unknown })?.collection
    );
    if (!collection) return c.json({ error: "Invalid collection name" }, 400);

    const existing = await db
      .select()
      .from(schema.siteDataCollections)
      .where(
        and(
          eq(schema.siteDataCollections.targetType, parsed.targetType),
          eq(schema.siteDataCollections.targetId, parsed.targetId),
          eq(schema.siteDataCollections.collection, collection)
        )
      )
      .get();

    const now = new Date().toISOString();
    if (existing) {
      await db
        .update(schema.siteDataCollections)
        .set({ enabled: true, updatedAt: now })
        .where(eq(schema.siteDataCollections.id, existing.id))
        .run();
      return c.json({
        data: { id: existing.id, collection, enabled: true },
      });
    }

    const id = generateId();
    await db.insert(schema.siteDataCollections).values({
      id,
      ownerUserId: target.ownerUserId,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      collection,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    return c.json({ data: { id, collection, enabled: true } }, 201);
  }
);

/**
 * DELETE /api/sites/:target/collections/:collection — disable a collection so
 * it stops accepting new submissions (existing records are retained).
 */
app.delete(
  "/:target/collections/:collection",
  requireScope("site-data:write"),
  async (c) => {
    const parsed = parseTargetParam(c.req.param("target"));
    if (!parsed) return c.json({ error: "Unknown target" }, 404);

    const userId = c.get("userId");
    const target = await authorizeManager(
      userId,
      parsed.targetType,
      parsed.targetId
    );
    if (!target) return c.json({ error: "Access denied" }, 403);

    const collection = normalizeCollectionName(c.req.param("collection"));
    if (!collection) return c.json({ error: "Invalid collection name" }, 400);

    await db
      .update(schema.siteDataCollections)
      .set({ enabled: false, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.siteDataCollections.targetType, parsed.targetType),
          eq(schema.siteDataCollections.targetId, parsed.targetId),
          eq(schema.siteDataCollections.collection, collection)
        )
      )
      .run();

    return c.json({ data: { disabled: true } });
  }
);

/**
 * GET /api/sites/:target/records — list submitted records for a target.
 * Optional ?collection= filter. Soft-deleted records are excluded.
 */
app.get("/:target/records", requireScope("site-data:read"), async (c) => {
  const parsed = parseTargetParam(c.req.param("target"));
  if (!parsed) return c.json({ error: "Unknown target" }, 404);

  const userId = c.get("userId");
  const target = await authorizeManager(
    userId,
    parsed.targetType,
    parsed.targetId
  );
  if (!target) return c.json({ error: "Access denied" }, 403);

  const collectionFilter = c.req.query("collection");
  const conditions = [
    eq(schema.siteDataRecords.targetType, parsed.targetType),
    eq(schema.siteDataRecords.targetId, parsed.targetId),
    isNull(schema.siteDataRecords.deletedAt),
  ];
  if (collectionFilter) {
    const normalized = normalizeCollectionName(collectionFilter);
    if (!normalized) return c.json({ error: "Invalid collection name" }, 400);
    conditions.push(eq(schema.siteDataRecords.collection, normalized));
  }

  const records = await db
    .select()
    .from(schema.siteDataRecords)
    .where(and(...conditions))
    .orderBy(desc(schema.siteDataRecords.createdAt));

  return c.json({ data: records.map(siteDataRecordResponse) });
});

/**
 * DELETE /api/sites/:target/records/:recordId — soft-delete one record.
 */
app.delete(
  "/:target/records/:recordId",
  requireScope("site-data:write"),
  async (c) => {
    const parsed = parseTargetParam(c.req.param("target"));
    if (!parsed) return c.json({ error: "Unknown target" }, 404);

    const userId = c.get("userId");
    const target = await authorizeManager(
      userId,
      parsed.targetType,
      parsed.targetId
    );
    if (!target) return c.json({ error: "Access denied" }, 403);

    const recordId = c.req.param("recordId");
    const record = await db
      .select({
        id: schema.siteDataRecords.id,
        targetType: schema.siteDataRecords.targetType,
        targetId: schema.siteDataRecords.targetId,
        deletedAt: schema.siteDataRecords.deletedAt,
      })
      .from(schema.siteDataRecords)
      .where(eq(schema.siteDataRecords.id, recordId))
      .get();

    if (
      !record ||
      record.targetType !== parsed.targetType ||
      record.targetId !== parsed.targetId
    ) {
      return c.json({ error: "Record not found" }, 404);
    }

    if (!record.deletedAt) {
      await db
        .update(schema.siteDataRecords)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(schema.siteDataRecords.id, recordId))
        .run();
    }

    return c.json({ data: { deleted: true } });
  }
);

export default app;
