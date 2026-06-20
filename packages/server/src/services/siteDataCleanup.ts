import { and, eq } from "drizzle-orm";
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
