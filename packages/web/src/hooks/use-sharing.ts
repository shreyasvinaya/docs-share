import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type {
  Share,
  SharedItem,
  CreateEmailShare,
  CreatePublicLink,
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

export function useRevokeShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => api.del(`/api/shares/${shareId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shares"] }),
  });
}
