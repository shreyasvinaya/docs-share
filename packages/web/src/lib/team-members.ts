import type { TeamMember, TeamRole } from "@patra/shared";

/**
 * Whether the current viewer may remove `member` from the team.
 *
 * Mirrors the server policy (packages/server/src/routes/teams.ts): only
 * owners/admins manage membership, and the last owner cannot be removed.
 * Self-removal (leaving) is handled separately, so it returns false here.
 */
export function canRemoveMember(args: {
  viewerRole: TeamRole | undefined;
  viewerUserId: string | undefined;
  member: Pick<TeamMember, "userId" | "role">;
  ownerCount: number;
}): boolean {
  const { viewerRole, viewerUserId, member, ownerCount } = args;
  if (viewerRole !== "owner" && viewerRole !== "admin") return false;
  if (member.userId === viewerUserId) return false; // use "leave" instead
  if (member.role === "owner" && ownerCount <= 1) return false; // last owner
  return true;
}
