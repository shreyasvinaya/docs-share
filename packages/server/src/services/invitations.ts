import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateId } from "../lib/crypto.js";

export interface AcceptInvitationResult {
  teamId: string;
  role: typeof schema.teamMembers.role.enumValues[number];
  membershipId: string;
  alreadyMember: boolean;
}

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
 * @returns The acceptance result, or `null` when the token is unknown.
 */
export async function acceptInvitationByToken(
  token: string,
  userId: string
): Promise<AcceptInvitationResult | null> {
  const invitation = await db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.token, token))
    .get();
  if (!invitation) return null;
  return acceptInvitation(invitation, userId);
}

/**
 * Accept every outstanding (not yet accepted) invitation addressed to `email`.
 *
 * Called when a user signs in so that invitations created before they had an
 * account are materialised into memberships automatically. Safe to call on
 * every sign-in: invitations already accepted are skipped.
 *
 * @returns The acceptance results for each invitation processed.
 */
export async function acceptPendingInvitationsForUser(params: {
  userId: string;
  email: string;
}): Promise<AcceptInvitationResult[]> {
  const pending = await db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.email, params.email))
    .all();

  const results: AcceptInvitationResult[] = [];
  for (const invitation of pending) {
    if (invitation.acceptedAt) continue;
    results.push(await acceptInvitation(invitation, params.userId));
  }
  return results;
}
