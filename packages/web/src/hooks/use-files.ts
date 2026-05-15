import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { FileNode, Commit } from "@docs-share/shared";

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
      files,
      path,
      message,
    }: {
      files: File[];
      path?: string;
      message?: string;
    }) => {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }
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
