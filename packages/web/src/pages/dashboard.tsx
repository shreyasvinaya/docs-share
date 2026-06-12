import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { usePersonalRepo } from "@/hooks/use-personal-repo";
import { useFiles } from "@/hooks/use-files";
import { useTeams } from "@/hooks/use-teams";
import { useIncomingShares } from "@/hooks/use-sharing";
import { EmptyState } from "@/components/common/empty-state";
import { CreateTeamDialog } from "@/components/teams/create-team-dialog";

export function DashboardPage() {
  const navigate = useNavigate();
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const { data: personalRepo } = usePersonalRepo();
  const repoId = personalRepo?.repo?.id;
  const { data: files } = useFiles(repoId);
  const { data: teams } = useTeams();
  const { data: incoming } = useIncomingShares();

  const recentFiles = (files ?? []).slice(0, 8);
  const recentShared = (incoming ?? []).slice(0, 5);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>

      {/* Quick actions */}
      <div className="mb-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => navigate("/files")}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Upload HTML
        </button>
        <button
          type="button"
          onClick={() => setShowCreateTeam(true)}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
          Create Team
        </button>
        <Link
          to="/settings"
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
          API Tokens
        </Link>
      </div>

      {/* Recent files */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent Files</h2>
          <Link
            to="/files"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
          </Link>
        </div>
        {recentFiles.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {recentFiles.map((file) => (
              <Link
                key={file.path}
                to={
                  file.type === "directory"
                    ? `/files/${file.path}`
                    : `/preview/${repoId}/${file.path}`
                }
                className="group rounded-lg border border-border p-4 transition-colors hover:bg-muted/50"
              >
                <div className="mb-2">
                  {file.type === "directory" ? (
                    <svg className="h-8 w-8 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                  ) : (
                    <svg className="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  )}
                </div>
                <p className="truncate text-sm font-medium group-hover:text-foreground">
                  {file.name}
                </p>
                {file.updatedAt && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(file.updatedAt).toLocaleDateString()}
                  </p>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No files yet"
            description="Upload your first HTML file to get started."
            action={
              <Link
                to="/files"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Go to Files
              </Link>
            }
          />
        )}
      </section>

      {/* Your teams */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your Teams</h2>
          <Link
            to="/teams"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
          </Link>
        </div>
        {teams && teams.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {teams.map((team) => (
              <Link
                key={team.id}
                to={`/teams/${team.id}`}
                className="group rounded-lg border border-border p-4 transition-colors hover:bg-muted/50"
              >
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                  {team.name[0].toUpperCase()}
                </div>
                <p className="truncate text-sm font-medium group-hover:text-foreground">
                  {team.name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {team.slug}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No teams yet"
            description="Create a team to collaborate with others."
            action={
              <button
                type="button"
                onClick={() => setShowCreateTeam(true)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Create Team
              </button>
            }
          />
        )}
      </section>

      {/* Shared with me */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Shared with Me</h2>
          <Link
            to="/shared"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
          </Link>
        </div>
        {recentShared.length > 0 ? (
          <div className="rounded-lg border border-border">
            {recentShared.map((item, i) => (
              <Link
                key={item.share.id}
                to={`/preview/${item.share.repoId}/${item.share.path ?? ""}`}
                className={`flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50 ${
                  i < recentShared.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <svg className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium">{item.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      from {item.ownerName}
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {item.share.permission}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nothing shared yet"
            description="Files shared with you will appear here."
          />
        )}
      </section>

      <CreateTeamDialog
        open={showCreateTeam}
        onClose={() => setShowCreateTeam(false)}
        onCreated={(teamId) => navigate(`/teams/${teamId}`)}
      />
    </div>
  );
}
