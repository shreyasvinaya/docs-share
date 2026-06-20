import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateId } from "../lib/crypto.js";

export interface AcceptInvitationResult {
  teamId: string;
  role: typeof schema.teamMembers.role.enumValues[number];
  membershipId: string;
  alreadyMember: boolean;
}

/**
 * Outcome of attempting to accept an invitation by token on behalf of a user.
 *
 * - `not_found`  — no invitation exists for the supplied token.
 * - `forbidden`  — the authenticated user does not own the invited email
 *   address (or no such user exists). The invitation is NOT consumed.
 * - `accepted`   — the invitation was accepted (or was already accepted and is
 *   resolved idempotently); `result` carries the membership details.
 */
export type AcceptInvitationByTokenOutcome =
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "accepted"; result: AcceptInvitationResult };

/**
 * Convert a single pending invitation into a real team membership.
 *
 * The operation is idempotent: re-running it for an already-accepted invitation
 * (or for a user who is already a member) does not create duplicate rows and
 * still resolves to the existing membership. The invitation is stamped with
 * `acceptedAt` the first time it is consumed.
 *
 * @param invitation - The invitation row to accept.
 * @param userId - The id of the now-registered user accepting the invitation.
 */
async function acceptInvitation(
  invitation: typeof schema.invitations.$inferSelect,
  userId: string
): Promise<AcceptInvitationResult> {
  const existing = await db
    .select()
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.teamId, invitation.teamId),
        eq(schema.teamMembers.userId, userId)
      )
    )
    .get();

  const now = new Date().toISOString();

  if (!invitation.acceptedAt) {
    await db
      .update(schema.invitations)
      .set({ acceptedAt: now })
      .where(eq(schema.invitations.id, invitation.id))
      .run();
  }

  if (existing) {
    return {
      teamId: invitation.teamId,
      role: existing.role,
      membershipId: existing.id,
      alreadyMember: true,
    };
  }

  const membershipId = generateId();
  await db
    .insert(schema.teamMembers)
    .values({
      id: membershipId,
      teamId: invitation.teamId,
      userId,
      role: invitation.role,
      joinedAt: now,
    })
    .run();

  return {
    teamId: invitation.teamId,
    role: invitation.role,
    membershipId,
    alreadyMember: false,
  };
}

/**
 * Accept an invitation identified by its opaque token on behalf of `userId`.
 *
 * Security: the invitation is bound to a specific email address. To prevent an
 * IDOR where any authenticated user could redeem someone else's token, the
 * authenticated user's own email must match the invitation's email
 * (case-insensitively). If the user does not exist or the emails differ, the
 * invitation is left untouched and `forbidden` is returned.
 *
 * The operation remains idempotent: re-accepting an already-accepted invitation
 * (by the rightful owner) resolves to the existing membership.
 *
 * @param token - The opaque invitation token.
 * @param userId - The id of the authenticated user attempting to accept.
 * @returns A discriminated outcome describing whether the invitation was
 *   accepted, the token was unknown, or the user was not authorised.
 */
export async function acceptInvitationByToken(
  token: string,
  userId: string
): Promise<AcceptInvitationByTokenOutcome> {
  const invitation = await db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.token, token))
    .get();
  if (!invitation) return { status: "not_found" };

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return { status: "forbidden" };
  }

  const result = await acceptInvitation(invitation, userId);
  return { status: "accepted", result };
}

/**
 * Accept every outstanding (not yet accepted) invitation addressed to the
 * signing-in user's verified email.
 *
 * Called when a user signs in so that invitations created before they had an
 * account are materialised into memberships automatically. Safe to call on
 * every sign-in: invitations already accepted are skipped.
 *
 * Security: the email used to match invitations is read from the user's CURRENT
 * database row (lowercased), never from a caller-supplied value. This prevents a
 * stale or spoofable email from being used to redeem invitations the user does
 * not actually own. Matching is case-insensitive.
 *
 * @param params.userId - The id of the freshly-authenticated user.
 * @returns The acceptance results for each invitation processed. Resolves to an
 *   empty array when the user no longer exists or has no pending invitations.
 */
export async function acceptPendingInvitationsForUser(params: {
  userId: string;
}): Promise<AcceptInvitationResult[]> {
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, params.userId))
    .get();
  if (!user) return [];

  const email = user.email.toLowerCase();
  const pending = await db
    .select()
    .from(schema.invitations)
    .where(sql`lower(${schema.invitations.email}) = ${email}`)
    .all();

  const results: AcceptInvitationResult[] = [];
  for (const invitation of pending) {
    if (invitation.acceptedAt) continue;
    results.push(await acceptInvitation(invitation, params.userId));
  }
  return results;
}
