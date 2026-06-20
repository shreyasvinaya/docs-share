import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { AuditEntry, ViewStats } from "@patra/shared";

export function useShareAnalytics(shareId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["analytics", "share", shareId],
    queryFn: () => api.get<ViewStats>(`/api/shares/${shareId}/analytics`),
    enabled: enabled && !!shareId,
  });
}

export function useDraftAnalytics(draftId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["analytics", "draft", draftId],
    queryFn: () => api.get<ViewStats>(`/api/drafts/${draftId}/analytics`),
    enabled: enabled && !!draftId,
  });
}

export function useAuditLog(enabled = true) {
  return useQuery({
    queryKey: ["audit"],
    queryFn: () => api.get<AuditEntry[]>("/api/audit"),
    enabled,
  });
}
