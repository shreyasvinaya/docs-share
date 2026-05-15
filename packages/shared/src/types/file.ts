import { z } from "zod";

export const fileNodeSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["file", "directory"]),
  sizeBytes: z.number().nullable(),
  mimeType: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export type FileNode = z.infer<typeof fileNodeSchema>;

export const commitSchema = z.object({
  sha: z.string(),
  message: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  date: z.string(),
});

export type Commit = z.infer<typeof commitSchema>;

export const uploadFileSchema = z.object({
  path: z.string().min(1),
  message: z.string().optional(),
});

export type UploadFile = z.infer<typeof uploadFileSchema>;
