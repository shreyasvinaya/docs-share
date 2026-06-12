import { z } from "zod";

export const draftSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  title: z.string(),
  createdAt: z.string(),
});

export type Draft = z.infer<typeof draftSchema>;
