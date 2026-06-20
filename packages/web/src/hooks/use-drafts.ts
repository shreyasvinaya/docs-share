import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { DraftListItem } from "@patra/shared";

export function useDrafts() {
  return useQuery({
    queryKey: ["drafts"],
    queryFn: () => api.get<DraftListItem[]>("/api/drafts"),
  });
}

export function useDeleteDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draftId: string) =>
      api.del<{ deleted: true }>(`/api/drafts/${draftId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["drafts"] }),
  });
}

export function useDuplicateDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draftId: string) =>
      api.post<DraftListItem>(`/api/drafts/${draftId}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["drafts"] }),
  });
}
