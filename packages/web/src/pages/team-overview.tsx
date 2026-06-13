import { useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router";
import { useTeam, useTeamMembers } from "@/hooks/use-teams";
import { useFiles, useUploadFile } from "@/hooks/use-files";
import type { UploadItem } from "@/hooks/use-files";
import { FileTree } from "@/components/files/file-tree";
import { FileUploadZone } from "@/components/files/file-upload-zone";
import { GitHubSyncPanel } from "@/components/files/github-sync-panel";
import { UserAvatar } from "@/components/common/user-avatar";
import { EmptyState } from "@/components/common/empty-state";

export function TeamOverviewPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const { data: team, isLoading: teamLoading } = useTeam(teamId);
  const { data: members } = useTeamMembers(teamId);

  const repoId = team?.repo?.id;
  const { data: files, isLoading: filesLoading } = useFiles(repoId);
  const upload = useUploadFile(repoId);

  const handleUpload = useCallback(
    (items: UploadItem[]) => {
      if (!repoId) return;
      upload.mutate({ items });
    },
    [repoId, upload],
  );

  const handleNavigate = useCallback(
    (path: string) => {
      // Navigate to the file preview for team files
      navigate(`/preview/${repoId}/${path}`);
    },
    [repoId, navigate],
  );

  if (teamLoading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Loading team...
      </div>
    );
  }

  if (!team) {
    return (
      <div className="py-16 text-center">
        <EmptyState
          title="Team not found"
          description="This team does not exist or you don't have access."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{team.name}</h1>
          {team.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {team.description}
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {members?.length ?? 0} member{(members?.length ?? 0) !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          to={`/teams/${teamId}/settings`}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </Link>
      </div>

      {/* Members preview */}
      {members && members.length > 0 && (
        <div className="mb-6 flex items-center gap-1">
          {members.slice(0, 5).map((m) => (
            <UserAvatar
              key={m.id}
              displayName={m.user?.displayName ?? "?"}
              avatarUrl={m.user?.avatarUrl}
              size="sm"
            />
          ))}
          {members.length > 5 && (
            <span className="ml-1 text-xs text-muted-foreground">
              +{members.length - 5} more
            </span>
          )}
        </div>
      )}

      {/* Upload */}
      <FileUploadZone
        onUpload={handleUpload}
        isUploading={upload.isPending}
        className="mb-6"
      />

      <GitHubSyncPanel repoId={repoId} />

      {/* Files */}
      {filesLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Loading files...
        </div>
      ) : files && files.length > 0 ? (
        <FileTree
          files={files}
          repoId={repoId!}
          onNavigate={handleNavigate}
        />
      ) : (
        <EmptyState
          title="No team files yet"
          description="Upload files to share with your team."
          icon={
            <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          }
        />
      )}
    </div>
  );
}
