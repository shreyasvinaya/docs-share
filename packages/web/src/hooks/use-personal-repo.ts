import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

interface PersonalRepoData {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  repo: { id: string; diskPath: string; headSha: string | null } | null;
}

export function usePersonalRepo() {
  return useQuery({
    queryKey: ["personal-repo"],
    queryFn: () => api.get<PersonalRepoData>("/api/users/me"),
  });
}
