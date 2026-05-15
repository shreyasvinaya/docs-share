import type { TeamRole } from "../types/team.js";
import type { SharePermission } from "../types/share.js";

export const ROLE_HIERARCHY: Record<TeamRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export const ROLE_CAN_WRITE: Record<TeamRole, boolean> = {
  owner: true,
  admin: true,
  member: true,
  viewer: false,
};

export const ROLE_CAN_MANAGE: Record<TeamRole, boolean> = {
  owner: true,
  admin: true,
  member: false,
  viewer: false,
};

export function canWrite(role: TeamRole): boolean {
  return ROLE_CAN_WRITE[role];
}

export function canManage(role: TeamRole): boolean {
  return ROLE_CAN_MANAGE[role];
}

export function hasPermission(
  required: SharePermission,
  actual: SharePermission
): boolean {
  if (required === "read") return true;
  return actual === "write";
}
