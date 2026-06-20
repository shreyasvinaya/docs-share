import { lt, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

/**
 * Result of a single delivery-log cleanup pass.
 */
export interface WebhookCleanupResult {
  /** Number of delivery rows removed because they aged past the retention cutoff. */
  deletedByAge: number;
  /** Number of delivery rows removed because they exceeded the per-webhook cap. */
  deletedByCap: number;
}

/**
 * Prune the unbounded `webhook_deliveries` log so it cannot grow without limit.
 *
 * Two complementary policies are applied:
 *
 *   1. Age-based retention — any delivery whose `created_at` is older than
 *      `retentionDays` (relative to `now`) is deleted. Backed by the
 *      `webhook_deliveries_created_at_idx` index for an efficient range delete.
 *   2. Per-webhook cap — for any single webhook, only the most recent
 *      `maxPerWebhook` deliveries are kept; older ones are deleted even if they
 *      are still within the retention window. This bounds a single noisy
 *      webhook from dominating the log.
 *
 * Both parameters default from config and a non-positive value disables that
 * policy. The comparison is lexicographic on the ISO-8601 `created_at` strings,
 * which matches chronological order for the `Z`-suffixed timestamps the app
 * writes.
 *
 * @param now - Reference instant; defaults to the current time. Injectable so
 *   tests can pin a deterministic cutoff.
 * @param retentionDays - Delete deliveries older than this many days. Pass <= 0
 *   to skip the age-based pass.
 * @param maxPerWebhook - Keep at most this many deliveries per webhook. Pass
 *   <= 0 to skip the per-webhook cap.
 */
export async function cleanupWebhookDeliveries(
  options: {
    now?: Date;
    retentionDays?: number;
    maxPerWebhook?: number;
  } = {}
): Promise<WebhookCleanupResult> {
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? 0;
  const maxPerWebhook = options.maxPerWebhook ?? 0;

  let deletedByAge = 0;
  let deletedByCap = 0;

  if (retentionDays > 0) {
    const cutoff = new Date(
      now.getTime() - retentionDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const old = await db
      .select({ id: schema.webhookDeliveries.id })
      .from(schema.webhookDeliveries)
      .where(lt(schema.webhookDeliveries.createdAt, cutoff))
      .all();

    if (old.length > 0) {
      await db
        .delete(schema.webhookDeliveries)
        .where(lt(schema.webhookDeliveries.createdAt, cutoff))
        .run();
      deletedByAge = old.length;
    }
  }

  if (maxPerWebhook > 0) {
    // A row is over the cap when at least `maxPerWebhook` newer deliveries exist
    // for the same webhook. The correlated subquery ranks each row by created_at
    // (newest first, id as a stable tiebreaker); rows with rank >= N are pruned.
    const overCapCondition = sql`(
      SELECT COUNT(*) FROM ${schema.webhookDeliveries} d2
      WHERE d2.webhook_id = ${schema.webhookDeliveries.webhookId}
        AND (d2.created_at > ${schema.webhookDeliveries.createdAt}
          OR (d2.created_at = ${schema.webhookDeliveries.createdAt}
            AND d2.id > ${schema.webhookDeliveries.id}))
    ) >= ${maxPerWebhook}`;

    // Count first so the deleted total is reported independently of the driver's
    // run() return shape.
    const overCap = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.webhookDeliveries)
      .where(overCapCondition)
      .get();
    deletedByCap = Number(overCap?.count ?? 0);

    if (deletedByCap > 0) {
      await db.delete(schema.webhookDeliveries).where(overCapCondition).run();
    }
  }

  return { deletedByAge, deletedByCap };
}
