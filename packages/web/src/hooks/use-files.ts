import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { FileNode, Commit } from "@docs-share/shared";

export interface UploadItem {
  file: File;
  relativePath: string;
}

export interface GitHubSync {
  id: string;
  repoId: string;
  repoUrl: string;
  branch: string;
  lastCommitSha: string | null;
  lastSyncedAt: string | null;
  status: "idle" | "syncing" | "success" | "error";
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useFiles(repoId: string | undefined, path?: string) {
  return useQuery({
    queryKey: ["files", repoId, path],
    queryFn: () => {
      const params = path ? `?path=${encodeURIComponent(path)}` : "";
      return api.get<FileNode[]>(`/api/files/${repoId}${params}`);
    },
    enabled: !!repoId,
  });
}

export function useCommits(
  repoId: string | undefined,
  path?: string,
  limit = 20
) {
  return useQuery({
    queryKey: ["commits", repoId, path],
    queryFn: () => {
      const params = new URLSearchParams();
      if (path) params.set("path", path);
      params.set("limit", String(limit));
      return api.get<Commit[]>(
        `/api/files/${repoId}/commits?${params.toString()}`
      );
    },
    enabled: !!repoId,
  });
}

export function useUploadFile(repoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      items,
      path,
      message,
    }: {
      items: UploadItem[];
      path?: string;
      message?: string;
    }) => {
      const formData = new FormData();
      const manifest: string[] = [];
      for (const item of items) {
        formData.append("files", item.file);
        manifest.push(item.relativePath);
      }
      formData.append("manifest", JSON.stringify(manifest));
      if (path) formData.append("path", path);
      if (message) formData.append("message", message);
      return api.upload<{ files: FileNode[] }>(
        `/api/files/${repoId}/upload`,
        formData
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["files", repoId] });
      qc.invalidateQueries({ queryKey: ["commits", repoId] });
    },
  });
}

export function useGitHubSync(repoId: string | undefined) {
  return useQuery({
    queryKey: ["github-sync", repoId],
    queryFn: () => api.get<GitHubSync | null>(`/api/repos/${repoId}/github-sync`),
    enabled: !!repoId,
  });
}

export function useRunGitHubSync(repoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { repoUrl?: string; branch?: string }) =>
      api.post<GitHubSync>(`/api/repos/${repoId}/github-sync`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github-sync", repoId] });
      qc.invalidateQueries({ queryKey: ["files", repoId] });
      qc.invalidateQueries({ queryKey: ["commits", repoId] });
    },
  });
}
