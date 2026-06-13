import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { User, ApiToken, CreateToken, UpdateUser } from "@docs-share/shared";

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => api.get<{ user: User }>("/api/auth/session"),
    retry: false,
  });
}

export function useOptionalSession() {
  return useQuery({
    queryKey: ["optional-session"],
    queryFn: async () => {
      const res = await fetch("/api/auth/session", {
        credentials: "include",
      });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Failed to load session");
      const body = (await res.json()) as { user: User };
      return body;
    },
    retry: false,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    onSuccess: () => {
      qc.clear();
      window.location.href = "/login";
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateUser) => api.patch<User>("/api/users/me", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["session"] });
      qc.invalidateQueries({ queryKey: ["personal-repo"] });
    },
  });
}

export function useApiTokens() {
  return useQuery({
    queryKey: ["api-tokens"],
    queryFn: async () => {
      const res = await api.get<{ tokens: ApiToken[] }>("/api/auth/tokens");
      return res.tokens;
    },
  });
}

export function useCreateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateToken) =>
      api.post<{ token: string; apiToken: ApiToken }>("/api/auth/tokens", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
  });
}

export function useRevokeToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => api.del(`/api/auth/tokens/${tokenId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
  });
}
