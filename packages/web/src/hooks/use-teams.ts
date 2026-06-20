import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type {
  Team,
  TeamMember,
  CreateTeam,
  InviteMember,
} from "@patra/shared";

export function useTeams() {
  return useQuery({
    queryKey: ["teams"],
    queryFn: () => api.get<Team[]>("/api/teams"),
  });
}

export function useTeam(teamId: string | undefined) {
  return useQuery({
    queryKey: ["teams", teamId],
    queryFn: () => api.get<Team>(`/api/teams/${teamId}`),
    enabled: !!teamId,
  });
}

export function useTeamMembers(teamId: string | undefined) {
  return useQuery({
    queryKey: ["teams", teamId, "members"],
    queryFn: () => api.get<TeamMember[]>(`/api/teams/${teamId}/members`),
    enabled: !!teamId,
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTeam) => api.post<Team>("/api/teams", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });
}

export function useUpdateTeam(teamId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name?: string; description?: string | null }) =>
      api.patch<Team>(`/api/teams/${teamId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["teams", teamId] });
    },
  });
}

export function useInviteMember(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: InviteMember) =>
      api.post<TeamMember>(`/api/teams/${teamId}/members`, data),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["teams", teamId, "members"] }),
  });
}

/**
 * Remove a member from the team. Deletes only the membership; the member's
 * account and everything they uploaded to the team stay intact.
 */
export function useRemoveMember(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.del(`/api/teams/${teamId}/members/${userId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["teams", teamId, "members"] }),
  });
}
