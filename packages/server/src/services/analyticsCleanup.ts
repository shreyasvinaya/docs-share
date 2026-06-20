import { lt } from "drizzle-orm";
import { db, schema } from "../db/index.js";

/**
 * Result of an age-based retention sweep over an append-only analytics table.
 */
export interface RetentionCleanupResult {
  /** Number of rows removed because they aged past the retention cutoff. */
  deletedByAge: number;
}

/**
 * Compute the ISO-8601 cutoff `retentionDays` before `now`. Rows whose
 * timestamp is strictly older than this are eligible for deletion. The
 * comparison is lexicographic on the `Z`-suffixed ISO strings the app writes,
 * which matches chronological order.
 */
function retentionCutoff(now: Date, retentionDays: number): string {
  return new Date(
    now.getTime() - retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();
}

/**
 * Prune the append-only `view_events` table so it cannot grow without bound.
 *
 * Any event whose `viewed_at` is older than `retentionDays` (relative to `now`)
 * is deleted. Backed by the `view_events_viewed_at_idx` index for an efficient
 * range delete. A non-positive `retentionDays` disables the sweep.
 *
 * @param now - Reference instant; defaults to the current time. Injectable so
 *   tests can pin a deterministic cutoff.
 * @param retentionDays - Delete events older than this many days. Pass <= 0 to
 *   skip the sweep.
 */
export async function cleanupViewEvents(
  options: { now?: Date; retentionDays?: number } = {}
): Promise<RetentionCleanupResult> {
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? 0;
  if (retentionDays <= 0) return { deletedByAge: 0 };

  const cutoff = retentionCutoff(now, retentionDays);
  const old = await db
    .select({ id: schema.viewEvents.id })
    .from(schema.viewEvents)
    .where(lt(schema.viewEvents.viewedAt, cutoff))
    .all();

  if (old.length === 0) return { deletedByAge: 0 };

  await db
    .delete(schema.viewEvents)
    .where(lt(schema.viewEvents.viewedAt, cutoff))
    .run();
  return { deletedByAge: old.length };
}

/**
 * Prune the append-only `audit_log` table so it cannot grow without bound.
 *
 * Any entry whose `created_at` is older than `retentionDays` (relative to
 * `now`) is deleted. Backed by the `audit_log_created_at_idx` index. A
 * non-positive `retentionDays` disables the sweep.
 *
 * @param now - Reference instant; defaults to the current time.
 * @param retentionDays - Delete entries older than this many days. Pass <= 0 to
 *   skip the sweep.
 */
export async function cleanupAuditLog(
  options: { now?: Date; retentionDays?: number } = {}
): Promise<RetentionCleanupResult> {
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? 0;
  if (retentionDays <= 0) return { deletedByAge: 0 };

  const cutoff = retentionCutoff(now, retentionDays);
  const old = await db
    .select({ id: schema.auditLog.id })
    .from(schema.auditLog)
    .where(lt(schema.auditLog.createdAt, cutoff))
    .all();

  if (old.length === 0) return { deletedByAge: 0 };

  await db
    .delete(schema.auditLog)
    .where(lt(schema.auditLog.createdAt, cutoff))
    .run();
  return { deletedByAge: old.length };
}
