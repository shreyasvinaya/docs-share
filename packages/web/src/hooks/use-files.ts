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
  sourcePath: string | null;
  lastCommitSha: string | null;
  lastSyncedAt: string | null;
  status: "idle" | "syncing" | "success" | "error";
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubTreeNode {
  path: string;
  name: string;
  type: "file" | "directory";
  size: number | null;
}

export interface GitHubRepositoryOption {
  fullName: string;
  repoUrl: string;
  defaultBranch: string;
  private: boolean;
  pushedAt: string | null;
  updatedAt: string | null;
  ownerLogin: string;
}

export interface GitHubOrganizationOption {
  login: string;
  description: string | null;
  avatarUrl: string | null;
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

export function useDeleteFile(repoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      api.del<{ commitSha: string; path: string; filesDeleted: number }>(
        `/api/files/${repoId}?path=${encodeURIComponent(path)}`
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["files", repoId] });
      qc.invalidateQueries({ queryKey: ["commits", repoId] });
    },
  });
}

export function useRestoreVersion(repoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sha, path }: { sha: string; path?: string }) =>
      api.post<{ commitSha: string; path: string | null }>(
        `/api/files/${repoId}/restore`,
        { sha, path }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["files", repoId] });
      qc.invalidateQueries({ queryKey: ["commits", repoId] });
    },
  });
}

export function useCopyFile(repoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      sourcePath: string;
      targetPath: string;
      targetRepoId?: string;
    }) =>
      api.post<{
        commitSha: string;
        sourcePath: string;
        targetPath: string;
        targetRepoId: string;
        filesCopied: number;
      }>(`/api/files/${repoId}/copy`, data),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["files", repoId] });
      qc.invalidateQueries({ queryKey: ["commits", repoId] });
      if (result.targetRepoId && result.targetRepoId !== repoId) {
        qc.invalidateQueries({ queryKey: ["files", result.targetRepoId] });
      }
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
    mutationFn: (data: { repoUrl?: string; branch?: string; sourcePath?: string }) =>
      api.post<GitHubSync>(`/api/repos/${repoId}/github-sync`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github-sync", repoId] });
      qc.invalidateQueries({ queryKey: ["files", repoId] });
      qc.invalidateQueries({ queryKey: ["commits", repoId] });
    },
  });
}

export function useGitHubRepositories(
  repoId: string | undefined,
  ownerLogin = "",
  enabled = true
) {
  return useQuery({
    queryKey: ["github-repositories", repoId, ownerLogin],
    queryFn: () => {
      const params = new URLSearchParams();
      if (ownerLogin) params.set("ownerLogin", ownerLogin);
      const query = params.toString();
      return api.get<GitHubRepositoryOption[]>(
        `/api/repos/${repoId}/github-sync/repositories${query ? `?${query}` : ""}`
      );
    },
    enabled: !!repoId && enabled,
    retry: false,
  });
}

export function useGitHubOrganizations(repoId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["github-organizations", repoId],
    queryFn: () =>
      api.get<GitHubOrganizationOption[]>(
        `/api/repos/${repoId}/github-sync/organizations`
      ),
    enabled: !!repoId && enabled,
    retry: false,
  });
}

export function useGitHubBranches(
  repoId: string | undefined,
  repoUrl: string,
  enabled = true
) {
  return useQuery({
    queryKey: ["github-branches", repoId, repoUrl],
    queryFn: () => {
      const params = new URLSearchParams({ repoUrl });
      return api.get<string[]>(
        `/api/repos/${repoId}/github-sync/branches?${params.toString()}`
      );
    },
    enabled: !!repoId && !!repoUrl.trim() && enabled,
    retry: false,
  });
}

export function useGitHubTree(
  repoId: string | undefined,
  repoUrl: string,
  branch: string,
  path: string
) {
  return useQuery({
    queryKey: ["github-tree", repoId, repoUrl, branch, path],
    queryFn: () => {
      const params = new URLSearchParams({
        repoUrl,
        branch: branch || "main",
      });
      if (path) params.set("path", path);
      return api.get<GitHubTreeNode[]>(
        `/api/repos/${repoId}/github-sync/tree?${params.toString()}`
      );
    },
    enabled: !!repoId && !!repoUrl.trim() && !!branch.trim(),
    retry: false,
  });
}
