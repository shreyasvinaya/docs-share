import { z } from "zod";

export const webhookEvents = [
  "share.created",
  "share.revoked",
  "github_sync.completed",
] as const;

export const webhookEventSchema = z.enum(webhookEvents);

export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export const webhookSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  events: z.array(webhookEventSchema),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Webhook = z.infer<typeof webhookSchema>;

// Returned only once, immediately after creation.
export const createdWebhookSchema = webhookSchema.extend({
  secret: z.string(),
});

export type CreatedWebhook = z.infer<typeof createdWebhookSchema>;

export const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(webhookEventSchema).min(1),
  active: z.boolean().optional(),
});

export type CreateWebhook = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(webhookEventSchema).min(1).optional(),
  active: z.boolean().optional(),
});

export type UpdateWebhook = z.infer<typeof updateWebhookSchema>;
