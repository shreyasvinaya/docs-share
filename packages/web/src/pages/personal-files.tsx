import { useCallback } from "react";
import { useLocation, useNavigate, Link } from "react-router";
import { usePersonalRepo } from "@/hooks/use-personal-repo";
import { useFiles, useUploadFile } from "@/hooks/use-files";
import { FileTree } from "@/components/files/file-tree";
import { FileUploadZone } from "@/components/files/file-upload-zone";
import { GitHubSyncPanel } from "@/components/files/github-sync-panel";
import type { UploadItem } from "@/hooks/use-files";
import { EmptyState } from "@/components/common/empty-state";

function useCurrentPath() {
  const location = useLocation();
  // /files/some/path → some/path
  const raw = location.pathname.replace(/^\/files\/?/, "");
  return raw || undefined;
}

export function PersonalFilesPage() {
  const navigate = useNavigate();
  const currentPath = useCurrentPath();
  const { data: personalRepo, isLoading: repoLoading } = usePersonalRepo();
  const repoId = personalRepo?.repo?.id;

  const { data: files, isLoading: filesLoading } = useFiles(repoId, currentPath);
  const upload = useUploadFile(repoId);

  const handleUpload = useCallback(
    (items: UploadItem[]) => {
      if (!repoId) return;
      upload.mutate({ items, path: currentPath });
    },
    [repoId, currentPath, upload],
  );

  const handleNavigate = useCallback(
    (path: string) => {
      navigate(`/files/${path}`);
    },
    [navigate],
  );

  const breadcrumbs = currentPath
    ? currentPath.split("/").filter(Boolean)
    : [];

  const isLoading = repoLoading || filesLoading;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Files</h1>
      </div>

      {/* Breadcrumbs */}
      {breadcrumbs.length > 0 && (
        <nav className="mb-4 flex items-center gap-1 text-sm">
          <Link
            to="/files"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Root
          </Link>
          {breadcrumbs.map((segment, i) => {
            const path = breadcrumbs.slice(0, i + 1).join("/");
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={path} className="flex items-center gap-1">
                <span className="text-muted-foreground">/</span>
                {isLast ? (
                  <span className="font-medium">{segment}</span>
                ) : (
                  <Link
                    to={`/files/${path}`}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {segment}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>
      )}

      {/* Upload zone */}
      <FileUploadZone
        onUpload={handleUpload}
        isUploading={upload.isPending}
        className="mb-6"
      />

      <GitHubSyncPanel repoId={repoId} />

      {/* File list */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Loading files...
        </div>
      ) : files && files.length > 0 ? (
        <FileTree
          files={files}
          repoId={repoId!}
          basePath={currentPath}
          onNavigate={handleNavigate}
        />
      ) : (
        <EmptyState
          title="No files here"
          description={
            currentPath
              ? "This folder is empty."
              : "Upload files to get started."
          }
          icon={
            <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          }
        />
      )}

      {upload.isError && (
        <p className="mt-4 text-sm text-destructive">
          Upload failed. Please try again.
        </p>
      )}
    </div>
  );
}
