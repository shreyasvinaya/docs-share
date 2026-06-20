import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateId, hashToken } from "../lib/crypto.js";

export type ViewTargetType = "share" | "draft" | "public";

export interface ViewStats {
  totalViews: number;
  uniqueVisitors: number;
  lastViewedAt: string | null;
  recentReferrers: string[];
}

const RECENT_REFERRER_LIMIT = 5;

/**
 * Computes a stable, non-reversible visitor fingerprint from the client IP and
 * User-Agent. The raw values are never persisted — only this hash is stored, so
 * unique-visitor counts can be derived without retaining PII.
 */
export function computeVisitorHash(
  ip: string | null | undefined,
  userAgent: string | null | undefined
): string {
  return hashToken(`${ip ?? ""}\n${userAgent ?? ""}`);
}

/**
 * Best-effort extraction of the originating client IP from proxy headers.
 * Returns null when no forwarding headers are present.
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
    referrer: input.referrer ?? null,
    userAgent: input.userAgent ?? null,
  });
}

/**
 * Records a view event without ever rejecting — failures are swallowed and
 * logged so analytics can never break content serving.
 */
export function recordViewEventSafe(input: RecordViewEventInput): void {
  recordViewEvent(input).catch((error) => {
    console.warn(
      "Failed to record view event",
      error instanceof Error ? error.message : String(error)
    );
  });
}

/** Records a view event from an incoming request, deriving ip/ua/referrer. */
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

  const referrerRows = await db
    .select({ referrer: schema.viewEvents.referrer })
    .from(schema.viewEvents)
    .where(where)
    .orderBy(desc(schema.viewEvents.viewedAt))
    .all();

  const recentReferrers: string[] = [];
  for (const row of referrerRows) {
    if (!row.referrer) continue;
    if (recentReferrers.includes(row.referrer)) continue;
    recentReferrers.push(row.referrer);
    if (recentReferrers.length >= RECENT_REFERRER_LIMIT) break;
  }

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
