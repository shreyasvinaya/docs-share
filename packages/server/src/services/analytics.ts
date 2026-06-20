import { and, desc, eq, gt, sql } from "drizzle-orm";
import { createHmac } from "node:crypto";
import type { Context } from "hono";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { generateId } from "../lib/crypto.js";
import { resolveClientIp } from "../lib/clientIp.js";
import type { AppEnv } from "../lib/types.js";

export type ViewTargetType = "share" | "draft" | "public";

export interface ViewStats {
  totalViews: number;
  uniqueVisitors: number;
  lastViewedAt: string | null;
  recentReferrers: string[];
}

const RECENT_REFERRER_LIMIT = 5;

/** Max characters stored for a referrer origin (defensive bound). */
const MAX_REFERRER_LENGTH = 255;

/** Window during which repeat views from the same visitor are deduplicated. */
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

/**
 * Computes a stable, non-reversible visitor fingerprint from the client IP and
 * User-Agent. The raw values are never persisted — only this hash is stored, so
 * unique-visitor counts can be derived without retaining PII.
 *
 * The hash is a keyed HMAC-SHA256 over a domain-separated input, using the
 * server's SESSION_SECRET (a 32+ char, prod-asserted secret) as the key. Keying
 * prevents offline brute-forcing of the small ip/user-agent input space that an
 * unkeyed hash would expose, so visitor identities cannot be recovered from a
 * leaked analytics table.
 */
export function computeVisitorHash(
  ip: string | null | undefined,
  userAgent: string | null | undefined
): string {
  return createHmac("sha256", config.SESSION_SECRET)
    .update(`analytics-visitor:v1:\n${ip ?? ""}\n${userAgent ?? ""}`)
    .digest("hex");
}

/**
 * Computes the keyed DEDUPE fingerprint for a target+visitor. Unlike
 * {@link computeVisitorHash}, this deliberately EXCLUDES the User-Agent: the UA
 * is fully attacker-controlled, so folding it in let a single source bypass the
 * 30-minute dedupe window simply by rotating its UA, inflating view counts. By
 * keying only on (targetType, targetId, ip) the dedupe is stable per source IP
 * regardless of UA churn. It stays a keyed HMAC over SESSION_SECRET so the
 * stored value is non-reversible (no raw IP/PII persisted).
 */
export function computeDedupeKey(
  targetType: ViewTargetType,
  targetId: string,
  ip: string | null | undefined
): string {
  return createHmac("sha256", config.SESSION_SECRET)
    .update(`view-dedupe:v1:${targetType}:${targetId}:${ip ?? ""}`)
    .digest("hex");
}

/**
 * Reduces a raw referrer header to just its origin (scheme + host), dropping
 * any path, query, or fragment that could carry tokens or PII. Returns null
 * when the value is absent or cannot be parsed as a URL.
 */
export function normalizeReferrer(
  referrer: string | null | undefined
): string | null {
  if (!referrer) return null;
  try {
    const origin = new URL(referrer).origin;
    if (!origin || origin === "null") return null;
    return origin.slice(0, MAX_REFERRER_LENGTH);
  } catch {
    return null;
  }
}

/**
 * Best-effort extraction of the originating client IP from proxy headers.
 * Returns null when no forwarding headers are present.
 *
 * NOTE: this reads the RAW, client-spoofable `X-Forwarded-For` / `X-Real-IP`
 * headers and is therefore NOT used to key view-event dedupe / visitor counts —
 * those go through the TRUST_PROXY-aware {@link resolveClientIp}. It is retained
 * only as a low-stakes header helper.
 */
export function extractClientIp(headers: Headers): string | null {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return null;
}

export interface RecordViewEventInput {
  targetType: ViewTargetType;
  targetId: string;
  ip?: string | null;
  userAgent?: string | null;
  referrer?: string | null;
}

/**
 * Persists a single view event. Designed to be fire-and-forget: callers should
 * not await this on the request hot path (use recordViewEventSafe).
 *
 * The raw IP and User-Agent are only used to derive the keyed visitor hash and
 * are never stored. The referrer is reduced to its origin before storage.
 */
export async function recordViewEvent(
  input: RecordViewEventInput
): Promise<void> {
  await db.insert(schema.viewEvents).values({
    id: generateId(),
    targetType: input.targetType,
    targetId: input.targetId,
    viewedAt: new Date().toISOString(),
    visitorHash: computeVisitorHash(input.ip, input.userAgent),
    // UA-independent dedupe fingerprint (see computeDedupeKey); stored so the
    // 30-minute dedupe check below can match repeat views from one source IP
    // even when the User-Agent is rotated.
    dedupeKey: computeDedupeKey(input.targetType, input.targetId, input.ip),
    referrer: normalizeReferrer(input.referrer),
  });
}

/**
 * Records a view event without ever rejecting — failures are swallowed and
 * logged so analytics can never break content serving.
 *
 * Dedupes lightly: if the same visitor already viewed the same target within
 * the last 30 minutes, the event is skipped so repeated requests for the same
 * page do not inflate view counts unboundedly.
 */
export function recordViewEventSafe(input: RecordViewEventInput): void {
  recordViewEventDeduped(input).catch((error) => {
    console.warn(
      "Failed to record view event",
      error instanceof Error ? error.message : String(error)
    );
  });
}

/**
 * Awaitable core of {@link recordViewEventSafe}: inserts the view event unless
 * the same visitor already viewed the same target within the dedupe window.
 * Exposed primarily so the behaviour can be tested deterministically.
 */
export async function recordViewEventDeduped(
  input: RecordViewEventInput
): Promise<void> {
  // Dedupe on the UA-INDEPENDENT key so rotating the (attacker-controlled)
  // User-Agent from one source IP cannot mint a fresh view within the window.
  const dedupeKey = computeDedupeKey(input.targetType, input.targetId, input.ip);
  const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();

  // The SELECT-then-INSERT is inherently TOCTOU: two concurrent requests for
  // the same target+visitor could both observe an empty window and both insert.
  // Running the check + insert inside a single transaction serializes them on
  // SQLite's write lock, so concurrent duplicates collapse to one row. This is
  // best-effort (kept cheap): it bounds, rather than perfectly prevents, races.
  await db.transaction(async (tx) => {
    const recent = await tx
      .select({ id: schema.viewEvents.id })
      .from(schema.viewEvents)
      .where(
        and(
          eq(schema.viewEvents.targetType, input.targetType),
          eq(schema.viewEvents.targetId, input.targetId),
          eq(schema.viewEvents.dedupeKey, dedupeKey),
          gt(schema.viewEvents.viewedAt, cutoff)
        )
      )
      .limit(1)
      .get();

    if (recent) return;

    await tx.insert(schema.viewEvents).values({
      id: generateId(),
      targetType: input.targetType,
      targetId: input.targetId,
      viewedAt: new Date().toISOString(),
      visitorHash: computeVisitorHash(input.ip, input.userAgent),
      // UA-independent dedupe fingerprint (see computeDedupeKey).
      dedupeKey,
      referrer: normalizeReferrer(input.referrer),
    });
  });
}

/**
 * Records a view event from an incoming request context, deriving ip/ua/referrer.
 *
 * Only actual page views are recorded: callers must confirm the served response
 * is an HTML document (content-type starts with `text/html`) before invoking
 * this, so sub-asset requests (css/js/images) never create view events.
 *
 * The client IP is resolved via the TRUST_PROXY-aware {@link resolveClientIp}
 * rather than from raw forwarding headers, so a spoofed `X-Forwarded-For` /
 * `X-Real-IP` cannot create distinct dedupe buckets or inflate unique-visitor
 * counts when the deployment does not trust a reverse proxy. This is the
 * preferred entry point for untrusted/public view paths (e.g. share links).
 */
export function recordViewFromContext(
  targetType: ViewTargetType,
  targetId: string,
  c: Context<AppEnv>
): void {
  recordViewEventSafe({
    targetType,
    targetId,
    ip: resolveClientIp(c),
    userAgent: c.req.header("user-agent") ?? null,
    referrer: c.req.header("referer") ?? c.req.header("referrer") ?? null,
  });
}

/**
 * Legacy entry point that derives the client IP from RAW forwarding headers via
 * {@link extractClientIp}. Retained only for owner-gated paths (e.g. a draft
 * owner previewing their own draft) where the viewer is already authenticated,
 * so header spoofing can at most perturb that owner's own dedupe and cannot
 * inflate cross-tenant counts. Untrusted/public paths must use
 * {@link recordViewFromContext} instead.
 */
export function recordViewFromRequest(
  targetType: ViewTargetType,
  targetId: string,
  req: Request
): void {
  recordViewEventSafe({
    targetType,
    targetId,
    ip: extractClientIp(req.headers),
    userAgent: req.headers.get("user-agent"),
    referrer: req.headers.get("referer") ?? req.headers.get("referrer"),
  });
}

/**
 * Returns true when an HTTP content-type identifies an HTML document. Used to
 * gate view recording so only page loads (not sub-assets) count as views.
 */
export function isHtmlContentType(
  contentType: string | null | undefined
): boolean {
  return (contentType ?? "").trim().toLowerCase().startsWith("text/html");
}

/** Aggregates view metrics for a single analytics target. */
export async function aggregateViewStats(
  targetType: ViewTargetType,
  targetId: string
): Promise<ViewStats> {
  const where = and(
    eq(schema.viewEvents.targetType, targetType),
    eq(schema.viewEvents.targetId, targetId)
  );

  const totals = await db
    .select({
      totalViews: sql<number>`count(*)`,
      uniqueVisitors: sql<number>`count(distinct ${schema.viewEvents.visitorHash})`,
      lastViewedAt: sql<string | null>`max(${schema.viewEvents.viewedAt})`,
    })
    .from(schema.viewEvents)
    .where(where)
    .get();

  // Compute the most-recent distinct referrer origins in SQL so we never load
  // the full event history into JS just to dedupe and slice it.
  const referrerRows = await db
    .select({
      referrer: schema.viewEvents.referrer,
      lastSeen: sql<string>`max(${schema.viewEvents.viewedAt})`,
    })
    .from(schema.viewEvents)
    .where(and(where, sql`${schema.viewEvents.referrer} is not null`))
    .groupBy(schema.viewEvents.referrer)
    .orderBy(desc(sql`max(${schema.viewEvents.viewedAt})`))
    .limit(RECENT_REFERRER_LIMIT)
    .all();

  const recentReferrers = referrerRows
    .map((row) => row.referrer)
    .filter((referrer): referrer is string => referrer !== null);

  return {
    totalViews: totals?.totalViews ?? 0,
    uniqueVisitors: totals?.uniqueVisitors ?? 0,
    lastViewedAt: totals?.lastViewedAt ?? null,
    recentReferrers,
  };
}

export interface RecordAuditEntryInput {
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Writes a single audit-log entry, serializing metadata to JSON. */
export async function recordAuditEntry(
  input: RecordAuditEntryInput
): Promise<void> {
  await db.insert(schema.auditLog).values({
    id: generateId(),
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    createdAt: new Date().toISOString(),
  });
}

/** Records an audit entry without ever rejecting. */
export function recordAuditEntrySafe(input: RecordAuditEntryInput): void {
  recordAuditEntry(input).catch((error) => {
    console.warn(
      "Failed to record audit entry",
      error instanceof Error ? error.message : String(error)
    );
  });
}

export interface AuditEntry {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditQueryOptions {
  actorUserId?: string;
  limit?: number;
}

/**
 * Lists audit entries newest-first. When actorUserId is supplied, only entries
 * performed by that user are returned (owner scope); omit it for sysadmin scope.
 */
export async function listAuditEntries(
  options: AuditQueryOptions = {}
): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);

  const rows = await db
    .select({
      id: schema.auditLog.id,
      actorUserId: schema.auditLog.actorUserId,
      action: schema.auditLog.action,
      targetType: schema.auditLog.targetType,
      targetId: schema.auditLog.targetId,
      metadata: schema.auditLog.metadata,
      createdAt: schema.auditLog.createdAt,
      actorName: schema.users.displayName,
      actorEmail: schema.users.email,
    })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.auditLog.actorUserId, schema.users.id))
    .where(
      options.actorUserId
        ? eq(schema.auditLog.actorUserId, options.actorUserId)
        : undefined
    )
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    id: row.id,
    actorUserId: row.actorUserId,
    actorName: row.actorName ?? null,
    actorEmail: row.actorEmail ?? null,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: row.metadata
      ? (JSON.parse(row.metadata) as Record<string, unknown>)
      : null,
    createdAt: row.createdAt,
  }));
}
