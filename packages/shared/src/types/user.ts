import { z } from "zod";

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  designation: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable(),
  role: z.enum(["user", "sysadmin"]).default("user"),
  createdAt: z.string(),
});

export type User = z.infer<typeof userSchema>;

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  designation: z.string().max(120).nullable().optional(),
});

export type UpdateUser = z.infer<typeof updateUserSchema>;
