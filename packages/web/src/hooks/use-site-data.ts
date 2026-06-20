import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { SiteDataCollection, SiteDataRecord } from "@patra/shared";

/**
 * Build the `:target` route segment ("draft:<id>" | "repo:<id>") for the
 * site-data API. Centralized so the encoding stays consistent with the server.
 */
export function siteDataTarget(
  targetType: "draft" | "repo",
  targetId: string
): string {
  return `${targetType}:${targetId}`;
}

export function useSiteDataCollections(target: string) {
  return useQuery({
    queryKey: ["site-data", target, "collections"],
    queryFn: () =>
      api.get<SiteDataCollection[]>(`/api/sites/${target}/collections`),
  });
}

export function useSiteDataRecords(target: string, collection?: string) {
  const query = collection
    ? `?collection=${encodeURIComponent(collection)}`
    : "";
  return useQuery({
    queryKey: ["site-data", target, "records", collection ?? null],
    queryFn: () =>
      api.get<SiteDataRecord[]>(`/api/sites/${target}/records${query}`),
  });
}

export function useEnableSiteDataCollection(target: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (collection: string) =>
      api.post<{ id: string; collection: string; enabled: boolean }>(
        `/api/sites/${target}/collections`,
        { collection }
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["site-data", target, "collections"] }),
  });
}

export function useDisableSiteDataCollection(target: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (collection: string) =>
      api.del<{ disabled: true }>(
        `/api/sites/${target}/collections/${encodeURIComponent(collection)}`
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["site-data", target, "collections"] }),
  });
}

export function useDeleteSiteDataRecord(target: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recordId: string) =>
      api.del<{ deleted: true }>(`/api/sites/${target}/records/${recordId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["site-data", target, "records"] }),
  });
}
