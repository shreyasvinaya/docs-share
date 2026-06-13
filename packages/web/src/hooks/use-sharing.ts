import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type {
  Share,
  SharedItem,
  CreateEmailShare,
  CreatePublicLink,
  CreateTeamShare,
} from "@docs-share/shared";

export function useMyShares() {
  return useQuery({
    queryKey: ["shares"],
    queryFn: () => api.get<Share[]>("/api/shares"),
  });
}

export function useIncomingShares() {
  return useQuery({
    queryKey: ["shares", "incoming"],
    queryFn: () => api.get<SharedItem[]>("/api/shares/incoming"),
  });
}

export function useSharesForResource(
  repoId: string | undefined,
  path: string | null | undefined
) {
  return useQuery({
    queryKey: ["shares", "for-resource", repoId, path ?? ""],
    queryFn: () => {
      const params = new URLSearchParams({ repoId: repoId! });
      if (path) params.set("path", path);
      return api.get<Share[]>(`/api/shares/for-resource?${params}`);
    },
    enabled: !!repoId,
  });
}

export function useCreateEmailShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateEmailShare) =>
      api.post<Share>("/api/shares", { ...data, shareType: "email" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shares"] }),
  });
}

export function useCreatePublicLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePublicLink) =>
      api.post<Share>("/api/shares", { ...data, shareType: "public_link" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shares"] }),
  });
}

export function useCreateTeamShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTeamShare) =>
      api.post<Share>("/api/shares", { ...data, shareType: "team" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shares"] }),
  });
}

export function useRevokeShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => api.del(`/api/shares/${shareId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shares"] }),
  });
}
