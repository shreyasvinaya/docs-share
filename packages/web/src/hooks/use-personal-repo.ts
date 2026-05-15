import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { User } from "@docs-share/shared";

interface PersonalRepoResponse {
  user: User;
  repo: { id: string; name: string; slug: string };
}

export function usePersonalRepo() {
  return useQuery({
    queryKey: ["personal-repo"],
    queryFn: () => api.get<PersonalRepoResponse>("/api/users/me"),
  });
}
