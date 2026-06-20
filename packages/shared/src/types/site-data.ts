import { z } from "zod";

export const siteDataTargetTypeSchema = z.enum(["draft", "repo"]);
export type SiteDataTargetType = z.infer<typeof siteDataTargetTypeSchema>;

export const siteDataFieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const siteDataRecordSchema = z.object({
  id: z.string(),
  collection: z.string(),
  fields: z.record(z.string(), siteDataFieldValueSchema),
  createdAt: z.string(),
});

export type SiteDataRecord = z.infer<typeof siteDataRecordSchema>;

export const siteDataCollectionSchema = z.object({
  id: z.string(),
  collection: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SiteDataCollection = z.infer<typeof siteDataCollectionSchema>;
