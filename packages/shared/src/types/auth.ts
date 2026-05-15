import { z } from "zod";

export const apiTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  tokenPrefix: z.string(),
  scopes: z.string(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type ApiToken = z.infer<typeof apiTokenSchema>;

export const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.string().default("*"),
  expiresIn: z.string().optional(),
});

export type CreateToken = z.infer<typeof createTokenSchema>;

export const authResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
});

export type AuthResponse = z.infer<typeof authResponseSchema>;
