import { z } from "zod";

export const teamRoles = ["owner", "admin", "member", "viewer"] as const;
export type TeamRole = (typeof teamRoles)[number];

export const teamSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  ownerId: z.string(),
  createdAt: z.string(),
});

export type Team = z.infer<typeof teamSchema>;

export const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
});

export type CreateTeam = z.infer<typeof createTeamSchema>;

export const teamMemberSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  userId: z.string(),
  role: z.enum(teamRoles),
  joinedAt: z.string(),
  user: z
    .object({
      email: z.string(),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
    })
    .optional(),
});

export type TeamMember = z.infer<typeof teamMemberSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(teamRoles).default("member"),
});

export type InviteMember = z.infer<typeof inviteMemberSchema>;
