import { z } from "zod";

export const shareTypes = ["email", "public_link", "team"] as const;
export type ShareType = (typeof shareTypes)[number];

export const sharePermissions = ["read", "write"] as const;
export type SharePermission = (typeof sharePermissions)[number];

export const linkAccessLevels = ["public", "org"] as const;
export type LinkAccess = (typeof linkAccessLevels)[number];

export const shareSchema = z.object({
  id: z.string(),
  repoId: z.string(),
  path: z.string().nullable(),
  createdById: z.string(),
  shareType: z.enum(shareTypes),
  permission: z.enum(sharePermissions),
  publicToken: z.string().nullable(),
  linkAccess: z.enum(linkAccessLevels).nullable().optional(),
  orgDomain: z.string().nullable().optional(),
  teamId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});

export type Share = z.infer<typeof shareSchema>;

export const createEmailShareSchema = z.object({
  repoId: z.string(),
  path: z.string().nullable().optional(),
  emails: z.array(z.string().email()).min(1),
  permission: z.enum(sharePermissions).default("read"),
});

export type CreateEmailShare = z.infer<typeof createEmailShareSchema>;

export const createPublicLinkSchema = z.object({
  repoId: z.string(),
  path: z.string().nullable().optional(),
  linkAccess: z.enum(linkAccessLevels).default("public"),
  expiresIn: z.string().optional(),
  password: z.string().optional(),
});

export type CreatePublicLink = z.infer<typeof createPublicLinkSchema>;

export const sharedItemSchema = z.object({
  share: shareSchema,
  fileName: z.string(),
  ownerName: z.string(),
  ownerEmail: z.string(),
});

export type SharedItem = z.infer<typeof sharedItemSchema>;
