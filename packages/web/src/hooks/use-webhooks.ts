import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type {
  CreateWebhook,
  CreatedWebhook,
  UpdateWebhook,
  Webhook,
} from "@docs-share/shared";

export function useWebhooks() {
  return useQuery({
    queryKey: ["webhooks"],
    queryFn: () => api.get<Webhook[]>("/api/webhooks"),
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWebhook) =>
      api.post<CreatedWebhook>("/api/webhooks", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateWebhook }) =>
      api.patch<Webhook>(`/api/webhooks/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ deleted: true }>(`/api/webhooks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });
}
