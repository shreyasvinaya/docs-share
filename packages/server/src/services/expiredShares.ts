import { and, inArray, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "../db/index.js";

/**
 * Delete shares whose `expiresAt` is in the past.
 *
 * Shares with a null `expiresAt` never expire and are left untouched. The
 * comparison is lexicographic on ISO-8601 timestamps, which is equivalent to a
 * chronological comparison for the `Z`-suffixed values stored by the app.
 *
 * @param now - Reference instant; defaults to the current time. Injectable so
 *   tests can pin a deterministic boundary.
 * @returns The ids of the shares that were deleted.
 */
export async function sweepExpiredShares(now: Date = new Date()): Promise<string[]> {
  const cutoff = now.toISOString();

  const expired = await db
    .select({ id: schema.shares.id })
    .from(schema.shares)
    .where(
      and(
        isNotNull(schema.shares.expiresAt),
        lte(schema.shares.expiresAt, cutoff)
      )
    )
    .all();

  if (expired.length === 0) return [];

  const ids = expired.map((row) => row.id);
  await db.delete(schema.shares).where(inArray(schema.shares.id, ids)).run();

  return ids;
}
