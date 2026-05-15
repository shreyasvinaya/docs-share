import { z } from "zod";

export const ownerTypes = ["user", "team"] as const;
export type OwnerType = (typeof ownerTypes)[number];

export const projectSchema = z.object({
  id: z.string(),
  ownerType: z.enum(ownerTypes),
  ownerUserId: z.string().nullable(),
  ownerTeamId: z.string().nullable(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  createdById: z.string(),
  createdAt: z.string(),
});

export type Project = z.infer<typeof projectSchema>;

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  description: z.string().max(500).optional(),
});

export type CreateProject = z.infer<typeof createProjectSchema>;
