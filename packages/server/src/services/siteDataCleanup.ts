import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { SiteDataTargetType } from "./siteData.js";

/**
 * Cascade-delete site-data rows for a target that no longer exists.
 *
 * Site-data collections and records are keyed by `(target_type, target_id)`,
 * but the targets themselves (drafts / repos) have no foreign key to those
 * rows. When a draft or repo is deleted, its collection opt-ins and submitted
 * records would otherwise be orphaned — letting the public ingestion endpoint
 * keep accepting writes against a dead target. Both deletion paths call this
 * helper so the opt-in and stored records are removed alongside the target.
 *
 * @param targetType - The target kind (`"draft"` or `"repo"`).
 * @param targetId - The target's id.
 */
export async function deleteSiteDataForTarget(
  targetType: SiteDataTargetType,
  targetId: string
): Promise<void> {
  await db
    .delete(schema.siteDataRecords)
    .where(
      and(
        eq(schema.siteDataRecords.targetType, targetType),
        eq(schema.siteDataRecords.targetId, targetId)
      )
    )
    .run();

  await db
    .delete(schema.siteDataCollections)
    .where(
      and(
        eq(schema.siteDataCollections.targetType, targetType),
        eq(schema.siteDataCollections.targetId, targetId)
      )
    )
    .run();
}

/**
 * Result of the soft-deleted site-data retention sweep.
 */
export interface SiteDataPurgeResult {
  /** Number of soft-deleted records permanently removed. */
  deletedByAge: number;
}

/**
 * Permanently remove site-data records that an owner soft-deleted more than
 * `retentionDays` ago.
 *
 * Owner deletes only set `deleted_at`; the rows stay on disk indefinitely,
 * which (combined with the public ingestion endpoint) lets storage grow without
 * bound even after cleanup. This sweep reclaims that space: any record whose
 * `deleted_at` is non-null AND older than the cutoff is deleted. A non-positive
 * `retentionDays` disables the purge.
 *
 * @param now - Reference instant; defaults to the current time. Injectable so
 *   tests can pin a deterministic cutoff.
 * @param retentionDays - Purge soft-deleted records older than this many days.
 *   Pass <= 0 to skip the sweep.
 */
export async function purgeDeletedSiteDataRecords(
  options: { now?: Date; retentionDays?: number } = {}
): Promise<SiteDataPurgeResult> {
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? 0;
  if (retentionDays <= 0) return { deletedByAge: 0 };

  const cutoff = new Date(
    now.getTime() - retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const predicate = and(
    isNotNull(schema.siteDataRecords.deletedAt),
    lt(schema.siteDataRecords.deletedAt, cutoff)
  );

  const old = await db
    .select({ id: schema.siteDataRecords.id })
    .from(schema.siteDataRecords)
    .where(predicate)
    .all();

  if (old.length === 0) return { deletedByAge: 0 };

  await db.delete(schema.siteDataRecords).where(predicate).run();
  return { deletedByAge: old.length };
}
