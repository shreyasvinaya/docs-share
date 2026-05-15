import { z } from "zod";

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  avatarUrl: z.string().url().nullable(),
  createdAt: z.string(),
});

export type User = z.infer<typeof userSchema>;

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
});

export type UpdateUser = z.infer<typeof updateUserSchema>;
