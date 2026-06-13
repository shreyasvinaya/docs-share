import { z } from "zod";

export const draftSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  title: z.string(),
  createdAt: z.string(),
});

export type Draft = z.infer<typeof draftSchema>;

export const draftListItemSchema = draftSchema.extend({
  sourceFilename: z.string(),
  sizeBytes: z.number(),
  updatedAt: z.string(),
});

export type DraftListItem = z.infer<typeof draftListItemSchema>;
