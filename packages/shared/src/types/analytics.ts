import { z } from "zod";

export const viewStatsSchema = z.object({
  totalViews: z.number(),
  uniqueVisitors: z.number(),
  lastViewedAt: z.string().nullable(),
  recentReferrers: z.array(z.string()),
});

export type ViewStats = z.infer<typeof viewStatsSchema>;

export const auditEntrySchema = z.object({
  id: z.string(),
  actorUserId: z.string().nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;
